# 🏀 HoopStats

> **Advanced NBA Props Betting Analytics Platform**

HoopStats is a comprehensive sports betting analytics platform that combines probabilistic projections, real-time line tracking, and data-driven recommendations to help bettors make informed decisions on NBA player prop bets.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)](https://www.postgresql.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://reactjs.org/)

## ✨ Features

### 🎯 Core Capabilities

- **Probabilistic Projections** - Full probability distributions for player stats (not just point estimates)
- **Multi-Sportsbook Line Tracking** - Real-time monitoring of 12+ major sportsbooks
- **Edge Calculation** - Quantifies betting edges with confidence levels
- **Line Movement Detection** - Alerts on significant line shifts
- **Track Record Transparency** - Historical performance metrics by stat type
- **Parlay Evaluation** - Analyzes correlated props for combo bets
- **Injury Monitoring** - Real-time lineup change detection (infrastructure ready)

### 📊 Data Sources

- ESPN API - Live games, box scores, player stats
- NBA API - Official league data
- TheOddsAPI - Betting lines from major sportsbooks
- Custom ML Models - Python-based projection engine

### 🎨 Tech Stack

**Frontend**
- React 18 + TypeScript
- Vite (build tool)
- TailwindCSS + Radix UI
- React Query (data management)
- Recharts (visualizations)
- Wouter (routing)

**Backend**
- Express.js + TypeScript
- PostgreSQL + Drizzle ORM
- Zod (validation)
- WebSocket support (planned)

**ML/Analytics**
- Python (NumPy, Pandas, SciPy)
- PyMC (Bayesian modeling)
- scikit-learn
- FastAPI (model serving)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Python 3.9+ (for ML models)
- Docker (optional, for containerized deployment)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/hoopstats.git
   cd hoopstats
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up the database**
   ```bash
   # Create database
   psql postgres -f migrations/setup.sql

   # Push schema
   npm run db:push

   # Seed initial data
   psql $DATABASE_URL -f migrations/001_seed_sportsbooks.sql
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Access the application**
   - Frontend: http://localhost:5000
   - API: http://localhost:5000/api

## 🐳 Docker Deployment

For easier deployment, use Docker:

```bash
# Start all services (app + database + redis)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

See [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) for detailed instructions.

## 📖 Documentation

- [Database Setup](./DATABASE_SETUP.md) - Database configuration and schema
- [Docker Deployment](./DOCKER_DEPLOYMENT.md) - Containerized deployment guide
- [Architecture Overview](./server/nba-prop-model/ARCHITECTURE.md) - ML model architecture
- [Line Tracking System](./LINE_TRACKING.md) - Real-time line monitoring
- [Analytics Features](./ANALYTICS_FEATURES.md) - Feature specifications

## 🔧 Configuration

### Environment Variables

Create a `.env` file with the following:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/hoopstats

# Server
PORT=5000
NODE_ENV=development

# API Keys (Optional but recommended)
BALLDONTLIE_API_KEY=your_key_here
ODDS_API_KEY=your_key_here
```

### API Keys

- **BallDontLie API**: Get key at https://www.balldontlie.io/
- **The Odds API**: Get key at https://the-odds-api.com/

Both are optional but enable enhanced features.

## 📝 Available Scripts

```bash
# Development
npm run dev          # Start development server
npm run build        # Build for production
npm start            # Start production server

# Testing
npm test             # Run tests
npm run test:watch   # Run tests in watch mode

# Database
npm run db:push      # Push schema changes to database

# Code Quality
npm run check        # Type check
```

## 🏗️ Project Structure

```
hoopstats/
├── client/           # React frontend
│   └── src/
│       ├── pages/    # Route pages
│       ├── components/ # React components
│       └── hooks/    # Custom hooks
├── server/           # Express backend
│   ├── routes.ts     # API endpoints
│   ├── storage.ts    # Database layer
│   ├── nba-api.ts    # NBA data integration
│   ├── espn-api.ts   # ESPN integration
│   ├── odds-api.ts   # Betting lines integration
│   └── nba-prop-model/ # Python ML models
├── shared/           # Shared TypeScript schemas
├── tests/            # Test files
├── migrations/       # Database migrations
└── docs/             # Documentation
```

## 🧪 Testing

Run the test suite:

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test tests/api.test.ts
```

## 📊 API Endpoints

### Players
- `GET /api/players` - List all players
- `GET /api/players/:id` - Get player details
- `GET /api/search?q=<name>` - Search players

### Betting
- `GET /api/bets` - Get betting recommendations
- `GET /api/recommendations/today` - Today's best plays
- `POST /api/bets/user` - Log a user bet
- `GET /api/bets/user` - Get user bet history

### Lines
- `GET /api/lines/player/:playerId` - Get lines for player
- `GET /api/lines/compare/:playerId` - Compare across sportsbooks
- `GET /api/lines/movements/recent` - Recent line movements

### Live Data
- `GET /api/live-games` - Current NBA games
- `GET /api/games/:gameId` - Game details
- `GET /api/players/:id/gamelog` - Player game log

### Projections
- `POST /api/projections` - Generate projection
- `POST /api/projections/parlay` - Evaluate parlay
- `GET /api/track-record` - Historical performance

### Odds
- `GET /api/odds/events` - Available betting events
- `GET /api/odds/events/:eventId/props` - Props for event

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Write tests for new features
- Follow TypeScript best practices
- Use Zod schemas for validation
- Document API changes
- Keep commits atomic and descriptive

## 🐛 Known Issues & Limitations

- **Injury Watcher**: Framework exists but requires API integration
- **Line Tracker**: Needs TheOddsAPI key for real-time updates
- **Authentication**: Not yet implemented (planned)
- **WebSocket**: Real-time updates not fully implemented

## 🗺️ Roadmap

### v1.1 (Next Release)
- [ ] Complete injury watcher implementation
- [ ] WebSocket support for real-time updates
- [ ] User authentication system
- [ ] Mobile-responsive design improvements

### v1.2 (Future)
- [ ] Machine learning model improvements
- [ ] Bankroll management tools
- [ ] Advanced parlay builder
- [ ] Historical data analysis
- [ ] API rate limiting

### v2.0 (Long-term)
- [ ] Multi-sport support
- [ ] Social features (share bets, follow others)
- [ ] Premium tier with advanced analytics
- [ ] Mobile app (React Native)

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- ESPN for providing public sports data APIs
- The Odds API for betting line data
- Ball Don't Lie API for NBA statistics
- Open source community for amazing tools

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/hoopstats/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/hoopstats/discussions)
- **Email**: support@hoopstats.com

## ⚠️ Disclaimer

**This software is for informational and educational purposes only.**

- Gambling can be addictive. Please gamble responsibly.
- This platform does not guarantee profits.
- Always do your own research before placing bets.
- Only bet what you can afford to lose.
- Check your local laws regarding sports betting.

**We are not responsible for any losses incurred using this platform.**

---

Built with ❤️ by the HoopStats Team
