module.exports = {
  apps: [{
    name: 'courtsideedge',
    script: 'dist/index.cjs',
    cwd: '/var/www/courtsideedge',
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
      TZ: 'America/New_York',
    },
    node_args: '--env-file=.env',
  }]
};
