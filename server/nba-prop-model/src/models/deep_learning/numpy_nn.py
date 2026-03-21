"""
Pure NumPy Neural Network Building Blocks

Implements LSTM and Dense layers with forward + backward passes,
and an Adam optimizer — no PyTorch/TensorFlow required.

All weight tensors are stored as plain numpy arrays so models
can be serialized with np.savez and loaded back trivially.
"""

from __future__ import annotations
from typing import Dict, List, Optional, Tuple
import numpy as np


# ---------------------------------------------------------------------------
# Activations
# ---------------------------------------------------------------------------

def sigmoid(x: np.ndarray) -> np.ndarray:
    # Numerically stable sigmoid
    return np.where(x >= 0, 1 / (1 + np.exp(-x)), np.exp(x) / (1 + np.exp(x)))


def sigmoid_grad(s: np.ndarray) -> np.ndarray:
    """Gradient of sigmoid given its *output* s."""
    return s * (1 - s)


def tanh_grad(t: np.ndarray) -> np.ndarray:
    """Gradient of tanh given its *output* t."""
    return 1 - t ** 2


def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(0, x)


def relu_grad(x: np.ndarray) -> np.ndarray:
    return (x > 0).astype(x.dtype)


# ---------------------------------------------------------------------------
# Dense layer
# ---------------------------------------------------------------------------

class Dense:
    """Fully-connected linear layer with optional activation."""

    def __init__(
        self,
        in_dim: int,
        out_dim: int,
        activation: str = "linear",
        name: str = "dense",
    ):
        self.in_dim = in_dim
        self.out_dim = out_dim
        self.activation = activation
        self.name = name

        # He initialisation for ReLU; Xavier for others
        if activation == "relu":
            scale = np.sqrt(2.0 / in_dim)
        else:
            scale = np.sqrt(1.0 / in_dim)

        self.W = np.random.randn(in_dim, out_dim) * scale
        self.b = np.zeros(out_dim)

        # Adam state
        self.mW = np.zeros_like(self.W)
        self.vW = np.zeros_like(self.W)
        self.mb = np.zeros_like(self.b)
        self.vb = np.zeros_like(self.b)

        # Cache for backward pass
        self._x: Optional[np.ndarray] = None
        self._pre_act: Optional[np.ndarray] = None

    @property
    def params(self) -> Dict[str, np.ndarray]:
        return {f"{self.name}_W": self.W, f"{self.name}_b": self.b}

    @property
    def moment_state(self) -> Dict[str, np.ndarray]:
        return {
            f"{self.name}_mW": self.mW, f"{self.name}_vW": self.vW,
            f"{self.name}_mb": self.mb, f"{self.name}_vb": self.vb,
        }

    def load_params(self, state: Dict[str, np.ndarray]):
        self.W = state[f"{self.name}_W"]
        self.b = state[f"{self.name}_b"]

    def load_moments(self, state: Dict[str, np.ndarray]):
        self.mW = state.get(f"{self.name}_mW", np.zeros_like(self.W))
        self.vW = state.get(f"{self.name}_vW", np.zeros_like(self.W))
        self.mb = state.get(f"{self.name}_mb", np.zeros_like(self.b))
        self.vb = state.get(f"{self.name}_vb", np.zeros_like(self.b))

    def forward(self, x: np.ndarray) -> np.ndarray:
        """x: (..., in_dim) → (..., out_dim)"""
        self._x = x
        pre = x @ self.W + self.b
        self._pre_act = pre
        if self.activation == "relu":
            return relu(pre)
        elif self.activation == "sigmoid":
            return sigmoid(pre)
        elif self.activation == "tanh":
            return np.tanh(pre)
        return pre  # linear

    def backward(self, d_out: np.ndarray) -> np.ndarray:
        """d_out: gradient w.r.t. output → returns gradient w.r.t. input."""
        pre = self._pre_act
        if self.activation == "relu":
            d_pre = d_out * relu_grad(pre)
        elif self.activation == "sigmoid":
            d_pre = d_out * sigmoid_grad(sigmoid(pre))
        elif self.activation == "tanh":
            d_pre = d_out * tanh_grad(np.tanh(pre))
        else:
            d_pre = d_out

        # Accumulate gradients (average over batch)
        batch_shape = d_pre.shape[:-1]
        n = int(np.prod(batch_shape)) if batch_shape else 1

        x = self._x
        self._dW = x.reshape(-1, self.in_dim).T @ d_pre.reshape(-1, self.out_dim) / n
        self._db = d_pre.reshape(-1, self.out_dim).mean(axis=0)
        return d_pre @ self.W.T

    def adam_update(self, t: int, lr: float = 1e-3, beta1: float = 0.9,
                    beta2: float = 0.999, eps: float = 1e-8):
        for param, grad, m, v, mk, vk in [
            (self.W, self._dW, self.mW, self.vW, "mW", "vW"),
            (self.b, self._db, self.mb, self.vb, "mb", "vb"),
        ]:
            m[:] = beta1 * m + (1 - beta1) * grad
            v[:] = beta2 * v + (1 - beta2) * grad ** 2
            m_hat = m / (1 - beta1 ** t)
            v_hat = v / (1 - beta2 ** t)
            param -= lr * m_hat / (np.sqrt(v_hat) + eps)


# ---------------------------------------------------------------------------
# LSTM Cell (single step)
# ---------------------------------------------------------------------------

class LSTMCell:
    """
    One LSTM cell — processes a single time step.

    Gates: [i]nput, [f]orget, [g]cell, [o]utput (concatenated for efficiency).
    """

    def __init__(self, input_dim: int, hidden_dim: int, name: str = "lstm"):
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.name = name
        H, I = hidden_dim, input_dim

        scale = np.sqrt(1.0 / (H + I))
        # Combined weight matrix [x, h] → 4H (i, f, g, o gates)
        self.Wx = np.random.randn(I, 4 * H) * scale
        self.Wh = np.random.randn(H, 4 * H) * scale
        self.b  = np.zeros(4 * H)

        # Adam moments
        self.mWx = np.zeros_like(self.Wx)
        self.vWx = np.zeros_like(self.Wx)
        self.mWh = np.zeros_like(self.Wh)
        self.vWh = np.zeros_like(self.Wh)
        self.mb  = np.zeros_like(self.b)
        self.vb  = np.zeros_like(self.b)

        # Forget gate bias initialised to 1 for gradient flow
        self.b[H:2*H] = 1.0

        self._dWx = np.zeros_like(self.Wx)
        self._dWh = np.zeros_like(self.Wh)
        self._db  = np.zeros_like(self.b)

    @property
    def params(self) -> Dict[str, np.ndarray]:
        return {
            f"{self.name}_Wx": self.Wx,
            f"{self.name}_Wh": self.Wh,
            f"{self.name}_b":  self.b,
        }

    @property
    def moment_state(self) -> Dict[str, np.ndarray]:
        return {
            f"{self.name}_mWx": self.mWx, f"{self.name}_vWx": self.vWx,
            f"{self.name}_mWh": self.mWh, f"{self.name}_vWh": self.vWh,
            f"{self.name}_mb":  self.mb,  f"{self.name}_vb":  self.vb,
        }

    def load_params(self, state: Dict[str, np.ndarray]):
        self.Wx = state[f"{self.name}_Wx"]
        self.Wh = state[f"{self.name}_Wh"]
        self.b  = state[f"{self.name}_b"]

    def load_moments(self, state: Dict[str, np.ndarray]):
        self.mWx = state.get(f"{self.name}_mWx", np.zeros_like(self.Wx))
        self.vWx = state.get(f"{self.name}_vWx", np.zeros_like(self.Wx))
        self.mWh = state.get(f"{self.name}_mWh", np.zeros_like(self.Wh))
        self.vWh = state.get(f"{self.name}_vWh", np.zeros_like(self.Wh))
        self.mb  = state.get(f"{self.name}_mb",  np.zeros_like(self.b))
        self.vb  = state.get(f"{self.name}_vb",  np.zeros_like(self.b))

    def forward(
        self,
        x: np.ndarray,   # (batch, input_dim)
        h: np.ndarray,   # (batch, hidden_dim)
        c: np.ndarray,   # (batch, hidden_dim)
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Returns (h_next, c_next) and caches intermediates."""
        H = self.hidden_dim
        gates = x @ self.Wx + h @ self.Wh + self.b  # (batch, 4H)

        i_gate = sigmoid(gates[:, 0*H:1*H])
        f_gate = sigmoid(gates[:, 1*H:2*H])
        g_gate = np.tanh(gates[:, 2*H:3*H])
        o_gate = sigmoid(gates[:, 3*H:4*H])

        c_next = f_gate * c + i_gate * g_gate
        tanh_c = np.tanh(c_next)
        h_next = o_gate * tanh_c

        # Cache everything for BPTT
        self._cache = (x, h, c, i_gate, f_gate, g_gate, o_gate, c_next, tanh_c)
        return h_next, c_next

    def backward(
        self,
        dh: np.ndarray,  # gradient from h_next
        dc: np.ndarray,  # gradient from c_next
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Returns (dx, dh_prev, dc_prev)."""
        x, h, c, i_gate, f_gate, g_gate, o_gate, c_next, tanh_c = self._cache
        H = self.hidden_dim

        # Gradient through h_next = o * tanh(c_next)
        do = dh * tanh_c
        dc_next = dh * o_gate * tanh_grad(tanh_c) + dc

        # Gradient through c_next = f * c + i * g
        df = dc_next * c
        dc_prev = dc_next * f_gate
        di = dc_next * g_gate
        dg = dc_next * i_gate

        # Gradient through gates (pre-activation)
        di_pre = di * sigmoid_grad(i_gate)
        df_pre = df * sigmoid_grad(f_gate)
        dg_pre = dg * tanh_grad(g_gate)
        do_pre = do * sigmoid_grad(o_gate)

        dgates = np.concatenate([di_pre, df_pre, dg_pre, do_pre], axis=-1)

        n = x.shape[0]
        self._dWx += x.T @ dgates / n
        self._dWh += h.T @ dgates / n
        self._db  += dgates.mean(axis=0)

        dx = dgates @ self.Wx.T
        dh_prev = dgates @ self.Wh.T
        return dx, dh_prev, dc_prev

    def zero_grad(self):
        self._dWx[:] = 0
        self._dWh[:] = 0
        self._db[:]  = 0

    def adam_update(self, t: int, lr: float = 1e-3, beta1: float = 0.9,
                    beta2: float = 0.999, eps: float = 1e-8):
        for param, grad, m, v in [
            (self.Wx, self._dWx, self.mWx, self.vWx),
            (self.Wh, self._dWh, self.mWh, self.vWh),
            (self.b,  self._db,  self.mb,  self.vb),
        ]:
            m[:] = beta1 * m + (1 - beta1) * grad
            v[:] = beta2 * v + (1 - beta2) * grad ** 2
            m_hat = m / (1 - beta1 ** t)
            v_hat = v / (1 - beta2 ** t)
            param -= lr * m_hat / (np.sqrt(v_hat) + eps)


# ---------------------------------------------------------------------------
# LSTM Layer (over full sequence)
# ---------------------------------------------------------------------------

class LSTMLayer:
    """Runs an LSTMCell over a full input sequence, returns final hidden state."""

    def __init__(self, input_dim: int, hidden_dim: int, name: str = "lstm"):
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.cell = LSTMCell(input_dim, hidden_dim, name=name)
        self._seq_len: int = 0
        self._h_states: List[np.ndarray] = []
        self._c_states: List[np.ndarray] = []

    @property
    def params(self) -> Dict[str, np.ndarray]:
        return self.cell.params

    @property
    def moment_state(self) -> Dict[str, np.ndarray]:
        return self.cell.moment_state

    def load_params(self, state: Dict[str, np.ndarray]):
        self.cell.load_params(state)

    def load_moments(self, state: Dict[str, np.ndarray]):
        self.cell.load_moments(state)

    def forward(self, seq: np.ndarray) -> np.ndarray:
        """
        seq: (batch, seq_len, input_dim)
        Returns final hidden state: (batch, hidden_dim)
        """
        batch, seq_len, _ = seq.shape
        H = self.hidden_dim
        h = np.zeros((batch, H))
        c = np.zeros((batch, H))

        self._seq_len = seq_len
        self._h_states = [h]
        self._c_states = [c]
        self._inputs = seq

        for t in range(seq_len):
            h, c = self.cell.forward(seq[:, t, :], h, c)
            self._h_states.append(h)
            self._c_states.append(c)

        return h  # final hidden state

    def backward(self, dh_final: np.ndarray) -> np.ndarray:
        """
        Backpropagation through time.
        Returns gradient w.r.t. input sequence: (batch, seq_len, input_dim)
        """
        seq_len = self._seq_len
        batch = dh_final.shape[0]
        dx_seq = np.zeros_like(self._inputs)

        self.cell.zero_grad()

        dh = dh_final
        dc = np.zeros_like(dh)

        # Re-run forward caches per step using stored states
        for t in reversed(range(seq_len)):
            # Re-load the cached state for this step
            h_prev = self._h_states[t]
            c_prev = self._c_states[t]
            x_t = self._inputs[:, t, :]

            # We need to re-run forward to populate cache for this step
            self.cell.forward(x_t, h_prev, c_prev)

            dx_t, dh, dc = self.cell.backward(dh, dc)
            dx_seq[:, t, :] = dx_t

        return dx_seq

    def zero_grad(self):
        self.cell.zero_grad()

    def adam_update(self, t: int, lr: float = 1e-3, **kwargs):
        self.cell.adam_update(t, lr, **kwargs)


# ---------------------------------------------------------------------------
# Dropout (inference-time passthrough)
# ---------------------------------------------------------------------------

class Dropout:
    """Inverted dropout. Pass-through during inference."""

    def __init__(self, rate: float = 0.3):
        self.rate = rate
        self.training = True
        self._mask: Optional[np.ndarray] = None

    def forward(self, x: np.ndarray) -> np.ndarray:
        if not self.training or self.rate == 0:
            return x
        self._mask = (np.random.rand(*x.shape) > self.rate) / (1 - self.rate)
        return x * self._mask

    def backward(self, d_out: np.ndarray) -> np.ndarray:
        if self._mask is None:
            return d_out
        return d_out * self._mask


# ---------------------------------------------------------------------------
# Batch Normalisation (1-D, simple running stats)
# ---------------------------------------------------------------------------

class BatchNorm1D:
    """
    Batch normalisation for 1-D feature vectors.
    Uses running mean/var at inference time.
    """

    def __init__(self, dim: int, eps: float = 1e-5, momentum: float = 0.1,
                 name: str = "bn"):
        self.dim = dim
        self.eps = eps
        self.momentum = momentum
        self.name = name
        self.training = True

        self.gamma = np.ones(dim)
        self.beta  = np.zeros(dim)
        self.running_mean = np.zeros(dim)
        self.running_var  = np.ones(dim)

        self._x_norm: Optional[np.ndarray] = None
        self._std: Optional[np.ndarray] = None

        # Adam moments for gamma/beta
        self.mg = np.zeros(dim); self.vg = np.zeros(dim)
        self.mb = np.zeros(dim); self.vb_  = np.zeros(dim)
        self._dg = np.zeros(dim); self._db = np.zeros(dim)

    @property
    def params(self) -> Dict[str, np.ndarray]:
        return {
            f"{self.name}_gamma": self.gamma,
            f"{self.name}_beta":  self.beta,
            f"{self.name}_running_mean": self.running_mean,
            f"{self.name}_running_var":  self.running_var,
        }

    def load_params(self, state: Dict[str, np.ndarray]):
        self.gamma = state[f"{self.name}_gamma"]
        self.beta  = state[f"{self.name}_beta"]
        self.running_mean = state[f"{self.name}_running_mean"]
        self.running_var  = state[f"{self.name}_running_var"]

    def forward(self, x: np.ndarray) -> np.ndarray:
        if self.training:
            mean = x.mean(axis=0)
            var  = x.var(axis=0)
            self.running_mean = (1 - self.momentum) * self.running_mean + self.momentum * mean
            self.running_var  = (1 - self.momentum) * self.running_var  + self.momentum * var
        else:
            mean = self.running_mean
            var  = self.running_var

        std = np.sqrt(var + self.eps)
        x_norm = (x - mean) / std
        self._x_norm = x_norm
        self._std = std
        return self.gamma * x_norm + self.beta

    def backward(self, d_out: np.ndarray) -> np.ndarray:
        n = d_out.shape[0]
        x_norm = self._x_norm
        std = self._std

        self._dg = (d_out * x_norm).sum(axis=0)
        self._db = d_out.sum(axis=0)

        dx_norm = d_out * self.gamma
        dvar  = (-0.5 * dx_norm * x_norm / (std ** 2)).sum(axis=0)
        dmean = (-dx_norm / std).sum(axis=0)
        dx = dx_norm / std + 2 * dvar * x_norm / n + dmean / n
        return dx

    def adam_update(self, t: int, lr: float = 1e-3, beta1: float = 0.9,
                    beta2: float = 0.999, eps: float = 1e-8):
        for param, grad, m, v in [
            (self.gamma, self._dg, self.mg, self.vg),
            (self.beta,  self._db, self.mb, self.vb_),
        ]:
            m[:] = beta1 * m + (1 - beta1) * grad
            v[:] = beta2 * v + (1 - beta2) * grad ** 2
            m_hat = m / (1 - beta1 ** t)
            v_hat = v / (1 - beta2 ** t)
            param -= lr * m_hat / (np.sqrt(v_hat) + eps)
