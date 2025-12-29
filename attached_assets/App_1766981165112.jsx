import React, { useState, useEffect, useMemo } from 'react';

// Sample data structure - this would come from the backend
const SAMPLE_PLAYERS = [
  {
    player_id: 1,
    player_name: "Luka Dončić",
    team: "DAL",
    season_averages: { PTS: 33.9, REB: 9.2, AST: 9.8, FG3M: 4.1, STL: 1.4, BLK: 0.5, PRA: 52.9, MIN: 37.2 },
    last_10_averages: { PTS: 35.2, REB: 8.8, AST: 10.1, FG3M: 4.3, PRA: 54.1, MIN: 38.1 },
    last_5_averages: { PTS: 37.8, REB: 9.4, AST: 9.2, FG3M: 4.8, PRA: 56.4, MIN: 38.5 },
    hit_rates: {
      PTS: { "20.5": 100, "25.5": 95.2, "30.5": 78.6, "35.5": 52.4 },
      REB: { "5.5": 97.6, "7.5": 83.3, "9.5": 50.0 },
      AST: { "6.5": 95.2, "8.5": 76.2, "10.5": 42.9 },
      PRA: { "40.5": 97.6, "45.5": 88.1, "50.5": 66.7, "55.5": 35.7 }
    },
    vs_team: {
      "LAL": { games: 3, PTS: 38.3, REB: 10.0, AST: 8.7, PRA: 57.0 },
      "PHX": { games: 4, PTS: 32.5, REB: 8.5, AST: 11.2, PRA: 52.2 },
      "DEN": { games: 3, PTS: 29.7, REB: 9.3, AST: 9.0, PRA: 48.0 }
    },
    recent_games: [
      { GAME_DATE: "DEC 26, 2024", OPPONENT: "LAL", PTS: 41, REB: 12, AST: 9, FG3M: 6, WL: "W", MIN: 39 },
      { GAME_DATE: "DEC 23, 2024", OPPONENT: "POR", PTS: 38, REB: 8, AST: 11, FG3M: 5, WL: "W", MIN: 36 },
      { GAME_DATE: "DEC 21, 2024", OPPONENT: "MIN", PTS: 33, REB: 9, AST: 8, FG3M: 4, WL: "L", MIN: 38 },
      { GAME_DATE: "DEC 19, 2024", OPPONENT: "HOU", PTS: 42, REB: 10, AST: 12, FG3M: 5, WL: "W", MIN: 40 },
      { GAME_DATE: "DEC 17, 2024", OPPONENT: "SAC", PTS: 35, REB: 7, AST: 9, FG3M: 4, WL: "W", MIN: 37 },
    ],
    home_averages: { PTS: 35.2, REB: 9.5, AST: 10.1, PRA: 54.8 },
    away_averages: { PTS: 32.6, REB: 8.9, AST: 9.5, PRA: 51.0 }
  },
  {
    player_id: 2,
    player_name: "Jayson Tatum",
    team: "BOS",
    season_averages: { PTS: 27.8, REB: 8.4, AST: 5.2, FG3M: 2.8, STL: 1.1, BLK: 0.6, PRA: 41.4, MIN: 36.1 },
    last_10_averages: { PTS: 29.1, REB: 8.8, AST: 5.5, FG3M: 3.1, PRA: 43.4, MIN: 36.8 },
    last_5_averages: { PTS: 31.2, REB: 9.2, AST: 4.8, FG3M: 3.4, PRA: 45.2, MIN: 37.2 },
    hit_rates: {
      PTS: { "20.5": 92.9, "25.5": 73.8, "30.5": 42.9 },
      REB: { "5.5": 92.9, "7.5": 71.4, "9.5": 35.7 },
      AST: { "4.5": 66.7, "6.5": 33.3 },
      PRA: { "35.5": 92.9, "40.5": 71.4, "45.5": 42.9 }
    },
    vs_team: {
      "MIA": { games: 3, PTS: 32.0, REB: 9.3, AST: 4.7, PRA: 46.0 },
      "NYK": { games: 4, PTS: 29.5, REB: 8.0, AST: 5.5, PRA: 43.0 },
      "PHI": { games: 3, PTS: 26.3, REB: 7.7, AST: 6.0, PRA: 40.0 }
    },
    recent_games: [
      { GAME_DATE: "DEC 26, 2024", OPPONENT: "IND", PTS: 32, REB: 10, AST: 4, FG3M: 4, WL: "W", MIN: 38 },
      { GAME_DATE: "DEC 23, 2024", OPPONENT: "PHI", PTS: 28, REB: 8, AST: 6, FG3M: 3, WL: "W", MIN: 36 },
      { GAME_DATE: "DEC 21, 2024", OPPONENT: "CHI", PTS: 35, REB: 11, AST: 5, FG3M: 4, WL: "W", MIN: 37 },
      { GAME_DATE: "DEC 19, 2024", OPPONENT: "ORL", PTS: 24, REB: 7, AST: 4, FG3M: 2, WL: "L", MIN: 35 },
      { GAME_DATE: "DEC 17, 2024", OPPONENT: "MIL", PTS: 29, REB: 9, AST: 6, FG3M: 3, WL: "W", MIN: 38 },
    ],
    home_averages: { PTS: 28.5, REB: 8.8, AST: 5.5, PRA: 42.8 },
    away_averages: { PTS: 27.1, REB: 8.0, AST: 4.9, PRA: 40.0 }
  },
  {
    player_id: 3,
    player_name: "Shai Gilgeous-Alexander",
    team: "OKC",
    season_averages: { PTS: 31.4, REB: 5.5, AST: 6.2, FG3M: 2.1, STL: 2.0, BLK: 0.9, PRA: 43.1, MIN: 34.5 },
    last_10_averages: { PTS: 33.8, REB: 5.2, AST: 6.8, FG3M: 2.4, PRA: 45.8, MIN: 35.2 },
    last_5_averages: { PTS: 35.4, REB: 5.8, AST: 7.2, FG3M: 2.6, PRA: 48.4, MIN: 35.8 },
    hit_rates: {
      PTS: { "25.5": 90.5, "30.5": 69.0, "35.5": 40.5 },
      REB: { "3.5": 90.5, "5.5": 57.1 },
      AST: { "4.5": 85.7, "6.5": 54.8 },
      PRA: { "35.5": 95.2, "40.5": 76.2, "45.5": 47.6 }
    },
    vs_team: {
      "LAL": { games: 3, PTS: 35.0, REB: 6.0, AST: 7.0, PRA: 48.0 },
      "PHX": { games: 3, PTS: 28.7, REB: 4.7, AST: 5.3, PRA: 38.7 },
      "DEN": { games: 4, PTS: 33.5, REB: 5.5, AST: 6.5, PRA: 45.5 }
    },
    recent_games: [
      { GAME_DATE: "DEC 26, 2024", OPPONENT: "MEM", PTS: 38, REB: 6, AST: 8, FG3M: 3, WL: "W", MIN: 36 },
      { GAME_DATE: "DEC 23, 2024", OPPONENT: "NOP", PTS: 32, REB: 5, AST: 7, FG3M: 2, WL: "W", MIN: 34 },
      { GAME_DATE: "DEC 21, 2024", OPPONENT: "UTA", PTS: 36, REB: 7, AST: 6, FG3M: 3, WL: "W", MIN: 35 },
      { GAME_DATE: "DEC 19, 2024", OPPONENT: "SAS", PTS: 34, REB: 4, AST: 9, FG3M: 2, WL: "W", MIN: 37 },
      { GAME_DATE: "DEC 17, 2024", OPPONENT: "GSW", PTS: 37, REB: 6, AST: 6, FG3M: 3, WL: "L", MIN: 36 },
    ],
    home_averages: { PTS: 32.8, REB: 5.8, AST: 6.5, PRA: 45.1 },
    away_averages: { PTS: 30.0, REB: 5.2, AST: 5.9, PRA: 41.1 }
  },
  {
    player_id: 4,
    player_name: "Giannis Antetokounmpo",
    team: "MIL",
    season_averages: { PTS: 31.5, REB: 12.0, AST: 6.1, FG3M: 0.6, STL: 1.2, BLK: 1.5, PRA: 49.6, MIN: 35.8 },
    last_10_averages: { PTS: 33.2, REB: 11.5, AST: 6.5, FG3M: 0.8, PRA: 51.2, MIN: 36.5 },
    last_5_averages: { PTS: 34.8, REB: 12.4, AST: 5.8, FG3M: 0.6, PRA: 53.0, MIN: 37.2 },
    hit_rates: {
      PTS: { "25.5": 90.5, "30.5": 66.7, "35.5": 40.5 },
      REB: { "9.5": 85.7, "11.5": 59.5, "13.5": 33.3 },
      AST: { "4.5": 78.6, "6.5": 47.6 },
      PRA: { "40.5": 95.2, "45.5": 78.6, "50.5": 52.4 }
    },
    vs_team: {
      "CHI": { games: 4, PTS: 34.0, REB: 13.5, AST: 6.0, PRA: 53.5 },
      "CLE": { games: 3, PTS: 28.7, REB: 11.0, AST: 5.7, PRA: 45.3 },
      "IND": { games: 4, PTS: 35.5, REB: 12.5, AST: 7.0, PRA: 55.0 }
    },
    recent_games: [
      { GAME_DATE: "DEC 26, 2024", OPPONENT: "BKN", PTS: 36, REB: 14, AST: 5, FG3M: 1, WL: "W", MIN: 38 },
      { GAME_DATE: "DEC 23, 2024", OPPONENT: "CHI", PTS: 33, REB: 12, AST: 7, FG3M: 0, WL: "W", MIN: 36 },
      { GAME_DATE: "DEC 21, 2024", OPPONENT: "TOR", PTS: 38, REB: 10, AST: 6, FG3M: 1, WL: "W", MIN: 37 },
      { GAME_DATE: "DEC 19, 2024", OPPONENT: "ATL", PTS: 32, REB: 13, AST: 5, FG3M: 0, WL: "W", MIN: 36 },
      { GAME_DATE: "DEC 17, 2024", OPPONENT: "DET", PTS: 29, REB: 11, AST: 8, FG3M: 1, WL: "L", MIN: 38 },
    ],
    home_averages: { PTS: 32.5, REB: 12.8, AST: 6.4, PRA: 51.7 },
    away_averages: { PTS: 30.5, REB: 11.2, AST: 5.8, PRA: 47.5 }
  },
  {
    player_id: 5,
    player_name: "Nikola Jokić",
    team: "DEN",
    season_averages: { PTS: 29.7, REB: 13.0, AST: 10.2, FG3M: 1.5, STL: 1.5, BLK: 0.8, PRA: 52.9, MIN: 37.0 },
    last_10_averages: { PTS: 31.4, REB: 14.2, AST: 11.1, FG3M: 1.8, PRA: 56.7, MIN: 38.2 },
    last_5_averages: { PTS: 28.6, REB: 15.0, AST: 12.4, FG3M: 1.4, PRA: 56.0, MIN: 38.0 },
    hit_rates: {
      PTS: { "20.5": 97.6, "25.5": 81.0, "30.5": 52.4 },
      REB: { "9.5": 97.6, "11.5": 85.7, "13.5": 59.5 },
      AST: { "6.5": 97.6, "8.5": 85.7, "10.5": 59.5 },
      PRA: { "45.5": 95.2, "50.5": 78.6, "55.5": 52.4 }
    },
    vs_team: {
      "LAL": { games: 4, PTS: 27.5, REB: 14.5, AST: 11.0, PRA: 53.0 },
      "PHX": { games: 3, PTS: 32.3, REB: 12.0, AST: 9.3, PRA: 53.7 },
      "MIN": { games: 4, PTS: 28.0, REB: 13.5, AST: 10.5, PRA: 52.0 }
    },
    recent_games: [
      { GAME_DATE: "DEC 26, 2024", OPPONENT: "PHX", PTS: 27, REB: 16, AST: 14, FG3M: 1, WL: "W", MIN: 39 },
      { GAME_DATE: "DEC 23, 2024", OPPONENT: "LAC", PTS: 31, REB: 14, AST: 11, FG3M: 2, WL: "W", MIN: 38 },
      { GAME_DATE: "DEC 21, 2024", OPPONENT: "POR", PTS: 25, REB: 13, AST: 15, FG3M: 1, WL: "W", MIN: 36 },
      { GAME_DATE: "DEC 19, 2024", OPPONENT: "GSW", PTS: 33, REB: 15, AST: 10, FG3M: 2, WL: "W", MIN: 40 },
      { GAME_DATE: "DEC 17, 2024", OPPONENT: "OKC", PTS: 28, REB: 17, AST: 12, FG3M: 1, WL: "L", MIN: 38 },
    ],
    home_averages: { PTS: 30.5, REB: 13.8, AST: 10.8, PRA: 55.1 },
    away_averages: { PTS: 28.9, REB: 12.2, AST: 9.6, PRA: 50.7 }
  }
];

const IMPACT_DATA = {
  "Luka Dončić": {
    games_missed: 4,
    teammates: [
      { name: "Kyrie Irving", with: { PTS: 24.2, REB: 4.5, AST: 5.1 }, without: { PTS: 29.8, REB: 5.2, AST: 7.4 }, diff: { PTS: 5.6, AST: 2.3 } },
      { name: "PJ Washington", with: { PTS: 12.8, REB: 7.2, AST: 1.8 }, without: { PTS: 16.5, REB: 8.8, AST: 2.4 }, diff: { PTS: 3.7, REB: 1.6 } },
      { name: "Klay Thompson", with: { PTS: 13.5, REB: 3.2, FG3M: 2.4 }, without: { PTS: 18.2, REB: 3.8, FG3M: 3.6 }, diff: { PTS: 4.7, FG3M: 1.2 } },
    ]
  },
  "Jayson Tatum": {
    games_missed: 2,
    teammates: [
      { name: "Jaylen Brown", with: { PTS: 24.8, REB: 5.5, AST: 3.8 }, without: { PTS: 30.5, REB: 6.2, AST: 5.1 }, diff: { PTS: 5.7, AST: 1.3 } },
      { name: "Derrick White", with: { PTS: 15.2, REB: 4.1, AST: 4.5 }, without: { PTS: 19.0, REB: 4.5, AST: 6.0 }, diff: { PTS: 3.8, AST: 1.5 } },
    ]
  },
  "Giannis Antetokounmpo": {
    games_missed: 5,
    teammates: [
      { name: "Damian Lillard", with: { PTS: 25.8, REB: 4.5, AST: 7.2 }, without: { PTS: 32.4, REB: 5.0, AST: 8.8 }, diff: { PTS: 6.6, AST: 1.6 } },
      { name: "Khris Middleton", with: { PTS: 15.5, REB: 4.8, AST: 4.2 }, without: { PTS: 22.0, REB: 5.5, AST: 5.8 }, diff: { PTS: 6.5, AST: 1.6 } },
      { name: "Bobby Portis", with: { PTS: 11.2, REB: 7.8, AST: 1.5 }, without: { PTS: 18.5, REB: 11.2, AST: 2.4 }, diff: { PTS: 7.3, REB: 3.4 } },
    ]
  },
  "Nikola Jokić": {
    games_missed: 3,
    teammates: [
      { name: "Jamal Murray", with: { PTS: 21.5, REB: 4.2, AST: 6.5 }, without: { PTS: 28.3, REB: 4.8, AST: 8.0 }, diff: { PTS: 6.8, AST: 1.5 } },
      { name: "Michael Porter Jr.", with: { PTS: 16.8, REB: 7.0, FG3M: 2.5 }, without: { PTS: 24.0, REB: 9.3, FG3M: 3.8 }, diff: { PTS: 7.2, REB: 2.3 } },
      { name: "Aaron Gordon", with: { PTS: 13.5, REB: 6.2, AST: 2.8 }, without: { PTS: 18.7, REB: 8.0, AST: 4.0 }, diff: { PTS: 5.2, REB: 1.8 } },
    ]
  }
};

const NBA_TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
];

// Sparkline component for mini charts
const Sparkline = ({ data, width = 80, height = 24, color = "#00ffc8" }) => {
  if (!data || data.length === 0) return null;
  
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
      />
      <circle
        cx={(data.length - 1) / (data.length - 1) * width}
        cy={height - ((data[data.length - 1] - min) / range) * height}
        r="2"
        fill={color}
      />
    </svg>
  );
};

// Stat badge with hit rate color coding
const StatBadge = ({ label, value, hitRate, trend }) => {
  const getHitRateColor = (rate) => {
    if (rate >= 80) return '#00ffc8';
    if (rate >= 60) return '#c8ff00';
    if (rate >= 40) return '#ffaa00';
    return '#ff4444';
  };
  
  const getTrendIcon = (t) => {
    if (t > 0) return '↑';
    if (t < 0) return '↓';
    return '→';
  };
  
  return (
    <div style={{
      background: 'rgba(0,255,200,0.05)',
      border: '1px solid rgba(0,255,200,0.2)',
      borderRadius: '4px',
      padding: '8px 12px',
      textAlign: 'center',
      minWidth: '80px'
    }}>
      <div style={{ 
        fontSize: '10px', 
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        marginBottom: '4px'
      }}>
        {label}
      </div>
      <div style={{ 
        fontSize: '20px', 
        fontFamily: "'JetBrains Mono', monospace",
        color: '#fff',
        fontWeight: '600'
      }}>
        {value}
        {trend !== undefined && (
          <span style={{ 
            fontSize: '12px', 
            color: trend > 0 ? '#00ffc8' : trend < 0 ? '#ff4444' : '#888',
            marginLeft: '4px'
          }}>
            {getTrendIcon(trend)}
          </span>
        )}
      </div>
      {hitRate !== undefined && (
        <div style={{ 
          fontSize: '10px', 
          color: getHitRateColor(hitRate),
          marginTop: '2px'
        }}>
          {hitRate}% hit
        </div>
      )}
    </div>
  );
};

// Player card component
const PlayerCard = ({ player, onSelect, isSelected }) => {
  return (
    <div 
      onClick={() => onSelect(player)}
      style={{
        background: isSelected 
          ? 'linear-gradient(135deg, rgba(0,255,200,0.15) 0%, rgba(0,100,80,0.1) 100%)'
          : 'rgba(20,25,30,0.8)',
        border: isSelected ? '1px solid #00ffc8' : '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: '16px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        backdropFilter: 'blur(10px)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: '600', 
            color: '#fff',
            marginBottom: '2px'
          }}>
            {player.player_name}
          </div>
          <div style={{ 
            fontSize: '12px', 
            color: '#00ffc8',
            fontFamily: "'JetBrains Mono', monospace"
          }}>
            {player.team}
          </div>
        </div>
        <div style={{
          background: 'rgba(0,255,200,0.1)',
          borderRadius: '4px',
          padding: '4px 8px',
          fontSize: '11px',
          color: '#00ffc8',
          fontFamily: "'JetBrains Mono', monospace"
        }}>
          {player.season_averages.MIN} MIN
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '16px', fontSize: '13px', fontFamily: "'JetBrains Mono', monospace" }}>
        <div>
          <span style={{ color: '#666' }}>PTS</span>
          <span style={{ color: '#fff', marginLeft: '6px' }}>{player.season_averages.PTS}</span>
        </div>
        <div>
          <span style={{ color: '#666' }}>REB</span>
          <span style={{ color: '#fff', marginLeft: '6px' }}>{player.season_averages.REB}</span>
        </div>
        <div>
          <span style={{ color: '#666' }}>AST</span>
          <span style={{ color: '#fff', marginLeft: '6px' }}>{player.season_averages.AST}</span>
        </div>
      </div>
      
      <div style={{ marginTop: '12px' }}>
        <Sparkline 
          data={player.recent_games.slice().reverse().map(g => g.PTS)}
          color={isSelected ? '#00ffc8' : '#666'}
        />
      </div>
    </div>
  );
};

// Hit rate bar visualization
const HitRateBar = ({ line, rate }) => {
  const getColor = (r) => {
    if (r >= 80) return '#00ffc8';
    if (r >= 60) return '#c8ff00';
    if (r >= 40) return '#ffaa00';
    return '#ff4444';
  };
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
      <div style={{ 
        width: '50px', 
        fontSize: '12px', 
        color: '#888',
        fontFamily: "'JetBrains Mono', monospace"
      }}>
        O {line}
      </div>
      <div style={{ 
        flex: 1, 
        height: '8px', 
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '4px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${rate}%`,
          height: '100%',
          background: getColor(rate),
          borderRadius: '4px',
          transition: 'width 0.5s ease'
        }} />
      </div>
      <div style={{ 
        width: '45px', 
        textAlign: 'right',
        fontSize: '12px',
        fontFamily: "'JetBrains Mono', monospace",
        color: getColor(rate)
      }}>
        {rate}%
      </div>
    </div>
  );
};

// Game log row
const GameRow = ({ game, index }) => {
  const isWin = game.WL === 'W';
  
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '100px 50px 50px 50px 50px 50px 40px',
      gap: '8px',
      padding: '10px 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      fontSize: '13px',
      fontFamily: "'JetBrains Mono', monospace",
      animation: `fadeIn 0.3s ease ${index * 0.05}s both`
    }}>
      <div style={{ color: '#888' }}>{game.GAME_DATE}</div>
      <div style={{ color: '#fff' }}>{game.OPPONENT}</div>
      <div style={{ color: '#00ffc8' }}>{game.PTS}</div>
      <div style={{ color: '#fff' }}>{game.REB}</div>
      <div style={{ color: '#fff' }}>{game.AST}</div>
      <div style={{ color: '#c8ff00' }}>{game.FG3M}</div>
      <div style={{ color: isWin ? '#00ffc8' : '#ff4444' }}>{game.WL}</div>
    </div>
  );
};

// Impact analysis card
const ImpactCard = ({ teammate }) => {
  return (
    <div style={{
      background: 'rgba(20,25,30,0.8)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '12px'
    }}>
      <div style={{ 
        fontSize: '14px', 
        fontWeight: '600', 
        color: '#fff',
        marginBottom: '12px'
      }}>
        {teammate.name}
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {Object.entries(teammate.diff).map(([stat, diff]) => (
          <div key={stat} style={{ textAlign: 'center' }}>
            <div style={{ 
              fontSize: '10px', 
              color: '#666',
              textTransform: 'uppercase',
              marginBottom: '4px'
            }}>
              {stat}
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: "'JetBrains Mono', monospace",
              color: diff > 0 ? '#00ffc8' : '#ff4444'
            }}>
              {diff > 0 ? '+' : ''}{diff.toFixed(1)}
            </div>
            <div style={{
              fontSize: '10px',
              color: '#888',
              marginTop: '2px'
            }}>
              {teammate.with[stat]?.toFixed(1)} → {teammate.without[stat]?.toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Main App
export default function NBABettingAnalytics() {
  const [players] = useState(SAMPLE_PLAYERS);
  const [selectedPlayer, setSelectedPlayer] = useState(SAMPLE_PLAYERS[0]);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedStat, setSelectedStat] = useState('PTS');
  const [selectedOpponent, setSelectedOpponent] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredPlayers = useMemo(() => {
    if (!searchTerm) return players;
    return players.filter(p => 
      p.player_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.team.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [players, searchTerm]);
  
  const impactData = IMPACT_DATA[selectedPlayer?.player_name];
  
  const vsTeamData = selectedOpponent && selectedPlayer?.vs_team?.[selectedOpponent];
  
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0c0f 0%, #0d1117 50%, #0a0c0f 100%)',
      color: '#fff',
      fontFamily: "'Inter', -apple-system, sans-serif",
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background grid effect */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,255,200,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,255,200,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        pointerEvents: 'none'
      }} />
      
      {/* Glow effects */}
      <div style={{
        position: 'absolute',
        top: '-20%',
        right: '-10%',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(0,255,200,0.1) 0%, transparent 70%)',
        pointerEvents: 'none'
      }} />
      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.05);
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(0,255,200,0.3);
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(0,255,200,0.5);
        }
      `}</style>
      
      {/* Header */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(10,12,15,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: '16px 24px'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          maxWidth: '1600px',
          margin: '0 auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #00ffc8 0%, #00a080 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              fontWeight: '700'
            }}>
              ◈
            </div>
            <div>
              <div style={{ 
                fontSize: '20px', 
                fontWeight: '700',
                background: 'linear-gradient(90deg, #fff 0%, #00ffc8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}>
                COURTSIDE EDGE
              </div>
              <div style={{ fontSize: '11px', color: '#666', letterSpacing: '2px' }}>
                NBA BETTING ANALYTICS
              </div>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: '#00ffc8',
              fontFamily: "'JetBrains Mono', monospace"
            }}>
              <span style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                background: '#00ffc8',
                animation: 'pulse 2s infinite'
              }} />
              LIVE DATA
            </div>
            <div style={{
              padding: '8px 16px',
              background: 'rgba(0,255,200,0.1)',
              border: '1px solid rgba(0,255,200,0.3)',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#00ffc8',
              cursor: 'pointer'
            }}>
              ⟳ Refresh Data
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main style={{ 
        maxWidth: '1600px', 
        margin: '0 auto', 
        padding: '24px',
        display: 'grid',
        gridTemplateColumns: '300px 1fr',
        gap: '24px'
      }}>
        {/* Left Sidebar - Player List */}
        <aside>
          <div style={{
            position: 'sticky',
            top: '100px'
          }}>
            <input
              type="text"
              placeholder="Search players..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'rgba(20,25,30,0.8)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                marginBottom: '16px',
                outline: 'none'
              }}
            />
            
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '8px',
              maxHeight: 'calc(100vh - 200px)',
              overflowY: 'auto',
              paddingRight: '8px'
            }}>
              {filteredPlayers.map(player => (
                <PlayerCard
                  key={player.player_id}
                  player={player}
                  onSelect={setSelectedPlayer}
                  isSelected={selectedPlayer?.player_id === player.player_id}
                />
              ))}
            </div>
          </div>
        </aside>
        
        {/* Right Content - Player Details */}
        <div>
          {selectedPlayer && (
            <>
              {/* Player Header */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(0,255,200,0.1) 0%, rgba(0,50,40,0.1) 100%)',
                border: '1px solid rgba(0,255,200,0.2)',
                borderRadius: '12px',
                padding: '24px',
                marginBottom: '24px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h1 style={{ 
                      fontSize: '32px', 
                      fontWeight: '700', 
                      margin: 0,
                      marginBottom: '4px'
                    }}>
                      {selectedPlayer.player_name}
                    </h1>
                    <div style={{ 
                      fontSize: '14px', 
                      color: '#00ffc8',
                      fontFamily: "'JetBrains Mono', monospace"
                    }}>
                      {selectedPlayer.team} • Season 2024-25
                    </div>
                  </div>
                  
                  <div style={{
                    background: 'rgba(0,0,0,0.3)',
                    borderRadius: '8px',
                    padding: '16px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>PRA SEASON AVG</div>
                    <div style={{ 
                      fontSize: '36px', 
                      fontWeight: '700',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: '#00ffc8'
                    }}>
                      {selectedPlayer.season_averages.PRA}
                    </div>
                  </div>
                </div>
                
                {/* Quick Stats */}
                <div style={{ 
                  display: 'flex', 
                  gap: '12px', 
                  marginTop: '20px',
                  flexWrap: 'wrap'
                }}>
                  <StatBadge 
                    label="PTS" 
                    value={selectedPlayer.season_averages.PTS}
                    trend={selectedPlayer.last_5_averages.PTS - selectedPlayer.season_averages.PTS}
                  />
                  <StatBadge 
                    label="REB" 
                    value={selectedPlayer.season_averages.REB}
                    trend={selectedPlayer.last_5_averages.REB - selectedPlayer.season_averages.REB}
                  />
                  <StatBadge 
                    label="AST" 
                    value={selectedPlayer.season_averages.AST}
                    trend={selectedPlayer.last_5_averages.AST - selectedPlayer.season_averages.AST}
                  />
                  <StatBadge 
                    label="3PM" 
                    value={selectedPlayer.season_averages.FG3M}
                    trend={selectedPlayer.last_5_averages.FG3M - selectedPlayer.season_averages.FG3M}
                  />
                  <StatBadge 
                    label="STL" 
                    value={selectedPlayer.season_averages.STL}
                  />
                  <StatBadge 
                    label="BLK" 
                    value={selectedPlayer.season_averages.BLK}
                  />
                </div>
              </div>
              
              {/* Tabs */}
              <div style={{
                display: 'flex',
                gap: '4px',
                marginBottom: '20px',
                background: 'rgba(20,25,30,0.5)',
                padding: '4px',
                borderRadius: '8px',
                width: 'fit-content'
              }}>
                {['overview', 'hit-rates', 'matchups', 'impact'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '10px 20px',
                      background: activeTab === tab ? 'rgba(0,255,200,0.2)' : 'transparent',
                      border: activeTab === tab ? '1px solid rgba(0,255,200,0.3)' : '1px solid transparent',
                      borderRadius: '6px',
                      color: activeTab === tab ? '#00ffc8' : '#888',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {tab.replace('-', ' ')}
                  </button>
                ))}
              </div>
              
              {/* Tab Content */}
              {activeTab === 'overview' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  {/* Averages Comparison */}
                  <div style={{
                    background: 'rgba(20,25,30,0.8)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px'
                  }}>
                    <h3 style={{ 
                      fontSize: '14px', 
                      fontWeight: '600', 
                      color: '#888',
                      marginTop: 0,
                      marginBottom: '16px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      Averages Comparison
                    </h3>
                    
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: '80px 1fr 1fr 1fr',
                      gap: '12px',
                      fontSize: '13px',
                      fontFamily: "'JetBrains Mono', monospace"
                    }}>
                      <div style={{ color: '#666' }}>STAT</div>
                      <div style={{ color: '#666', textAlign: 'center' }}>SEASON</div>
                      <div style={{ color: '#666', textAlign: 'center' }}>L10</div>
                      <div style={{ color: '#666', textAlign: 'center' }}>L5</div>
                      
                      {['PTS', 'REB', 'AST', 'FG3M', 'PRA'].map(stat => (
                        <React.Fragment key={stat}>
                          <div style={{ color: '#fff' }}>{stat}</div>
                          <div style={{ textAlign: 'center', color: '#888' }}>
                            {selectedPlayer.season_averages[stat]}
                          </div>
                          <div style={{ 
                            textAlign: 'center',
                            color: selectedPlayer.last_10_averages[stat] > selectedPlayer.season_averages[stat] 
                              ? '#00ffc8' : '#ff4444'
                          }}>
                            {selectedPlayer.last_10_averages[stat]}
                          </div>
                          <div style={{ 
                            textAlign: 'center',
                            color: selectedPlayer.last_5_averages[stat] > selectedPlayer.season_averages[stat] 
                              ? '#00ffc8' : '#ff4444'
                          }}>
                            {selectedPlayer.last_5_averages[stat]}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  
                  {/* Home/Away Splits */}
                  <div style={{
                    background: 'rgba(20,25,30,0.8)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px'
                  }}>
                    <h3 style={{ 
                      fontSize: '14px', 
                      fontWeight: '600', 
                      color: '#888',
                      marginTop: 0,
                      marginBottom: '16px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      Home / Away Splits
                    </h3>
                    
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: '80px 1fr 1fr',
                      gap: '12px',
                      fontSize: '13px',
                      fontFamily: "'JetBrains Mono', monospace"
                    }}>
                      <div style={{ color: '#666' }}>STAT</div>
                      <div style={{ color: '#666', textAlign: 'center' }}>🏠 HOME</div>
                      <div style={{ color: '#666', textAlign: 'center' }}>✈️ AWAY</div>
                      
                      {['PTS', 'REB', 'AST', 'PRA'].map(stat => (
                        <React.Fragment key={stat}>
                          <div style={{ color: '#fff' }}>{stat}</div>
                          <div style={{ 
                            textAlign: 'center',
                            color: selectedPlayer.home_averages[stat] >= selectedPlayer.away_averages[stat] 
                              ? '#00ffc8' : '#888'
                          }}>
                            {selectedPlayer.home_averages[stat]}
                          </div>
                          <div style={{ 
                            textAlign: 'center',
                            color: selectedPlayer.away_averages[stat] > selectedPlayer.home_averages[stat] 
                              ? '#00ffc8' : '#888'
                          }}>
                            {selectedPlayer.away_averages[stat]}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  
                  {/* Recent Games */}
                  <div style={{
                    gridColumn: '1 / -1',
                    background: 'rgba(20,25,30,0.8)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px'
                  }}>
                    <h3 style={{ 
                      fontSize: '14px', 
                      fontWeight: '600', 
                      color: '#888',
                      marginTop: 0,
                      marginBottom: '16px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      Recent Game Log
                    </h3>
                    
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '100px 50px 50px 50px 50px 50px 40px',
                      gap: '8px',
                      padding: '10px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      fontSize: '11px',
                      color: '#666',
                      textTransform: 'uppercase'
                    }}>
                      <div>Date</div>
                      <div>Opp</div>
                      <div>PTS</div>
                      <div>REB</div>
                      <div>AST</div>
                      <div>3PM</div>
                      <div>W/L</div>
                    </div>
                    
                    {selectedPlayer.recent_games.map((game, i) => (
                      <GameRow key={i} game={game} index={i} />
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'hit-rates' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  {/* Stat selector */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{
                      display: 'flex',
                      gap: '8px',
                      marginBottom: '20px'
                    }}>
                      {['PTS', 'REB', 'AST', 'PRA', 'STOCKS'].map(stat => (
                        <button
                          key={stat}
                          onClick={() => setSelectedStat(stat)}
                          style={{
                            padding: '8px 16px',
                            background: selectedStat === stat ? '#00ffc8' : 'rgba(255,255,255,0.1)',
                            border: 'none',
                            borderRadius: '6px',
                            color: selectedStat === stat ? '#000' : '#fff',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          {stat}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Hit Rate Bars */}
                  <div style={{
                    background: 'rgba(20,25,30,0.8)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px'
                  }}>
                    <h3 style={{ 
                      fontSize: '14px', 
                      fontWeight: '600', 
                      color: '#888',
                      marginTop: 0,
                      marginBottom: '16px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      {selectedStat} Hit Rates (Season)
                    </h3>
                    
                    {selectedPlayer.hit_rates[selectedStat] && 
                      Object.entries(selectedPlayer.hit_rates[selectedStat]).map(([line, rate]) => (
                        <HitRateBar key={line} line={line} rate={rate} />
                      ))
                    }
                  </div>
                  
                  {/* Betting Insights */}
                  <div style={{
                    background: 'rgba(20,25,30,0.8)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px'
                  }}>
                    <h3 style={{ 
                      fontSize: '14px', 
                      fontWeight: '600', 
                      color: '#888',
                      marginTop: 0,
                      marginBottom: '16px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      Betting Insights
                    </h3>
                    
                    <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
                      <p style={{ color: '#ccc', margin: '0 0 12px 0' }}>
                        <span style={{ color: '#00ffc8' }}>Best Value:</span> {selectedStat} lines where hit rate {'>'} 70% offer favorable odds
                      </p>
                      <p style={{ color: '#ccc', margin: '0 0 12px 0' }}>
                        <span style={{ color: '#c8ff00' }}>Trending:</span> L5 average of {selectedPlayer.last_5_averages[selectedStat]} vs season {selectedPlayer.season_averages[selectedStat]} indicates {
                          selectedPlayer.last_5_averages[selectedStat] > selectedPlayer.season_averages[selectedStat] 
                            ? 'upward momentum' : 'slight regression'
                        }
                      </p>
                      <p style={{ color: '#ccc', margin: 0 }}>
                        <span style={{ color: '#ffaa00' }}>Caution:</span> Consider matchup and rest days before final decision
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'matchups' && (
                <div>
                  {/* Opponent selector */}
                  <div style={{ marginBottom: '20px' }}>
                    <select
                      value={selectedOpponent}
                      onChange={(e) => setSelectedOpponent(e.target.value)}
                      style={{
                        padding: '12px 16px',
                        background: 'rgba(20,25,30,0.8)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '14px',
                        cursor: 'pointer',
                        minWidth: '200px'
                      }}
                    >
                      <option value="">Select opponent...</option>
                      {NBA_TEAMS.filter(t => t !== selectedPlayer.team).map(team => (
                        <option key={team} value={team}>{team}</option>
                      ))}
                    </select>
                  </div>
                  
                  {vsTeamData ? (
                    <div style={{
                      background: 'rgba(20,25,30,0.8)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      padding: '24px'
                    }}>
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '20px'
                      }}>
                        <h3 style={{ 
                          fontSize: '16px', 
                          fontWeight: '600', 
                          color: '#fff',
                          margin: 0
                        }}>
                          vs {selectedOpponent} ({vsTeamData.games} games)
                        </h3>
                      </div>
                      
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '16px'
                      }}>
                        {['PTS', 'REB', 'AST', 'PRA'].map(stat => {
                          const vsAvg = vsTeamData[stat];
                          const seasonAvg = selectedPlayer.season_averages[stat];
                          const diff = vsAvg - seasonAvg;
                          
                          return (
                            <div key={stat} style={{
                              background: 'rgba(0,0,0,0.3)',
                              borderRadius: '8px',
                              padding: '16px',
                              textAlign: 'center'
                            }}>
                              <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                                {stat}
                              </div>
                              <div style={{ 
                                fontSize: '24px', 
                                fontWeight: '600',
                                fontFamily: "'JetBrains Mono', monospace",
                                color: '#fff'
                              }}>
                                {vsAvg}
                              </div>
                              <div style={{ 
                                fontSize: '12px', 
                                color: diff > 0 ? '#00ffc8' : diff < 0 ? '#ff4444' : '#888',
                                marginTop: '4px'
                              }}>
                                {diff > 0 ? '+' : ''}{diff.toFixed(1)} vs avg
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : selectedOpponent ? (
                    <div style={{
                      background: 'rgba(20,25,30,0.8)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      padding: '40px',
                      textAlign: 'center',
                      color: '#888'
                    }}>
                      No games played against {selectedOpponent} this season
                    </div>
                  ) : (
                    <div style={{
                      background: 'rgba(20,25,30,0.8)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      padding: '40px',
                      textAlign: 'center',
                      color: '#888'
                    }}>
                      Select an opponent to view matchup data
                    </div>
                  )}
                  
                  {/* All matchups quick view */}
                  <div style={{
                    marginTop: '24px',
                    background: 'rgba(20,25,30,0.8)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    padding: '20px'
                  }}>
                    <h3 style={{ 
                      fontSize: '14px', 
                      fontWeight: '600', 
                      color: '#888',
                      marginTop: 0,
                      marginBottom: '16px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      All Matchup Data
                    </h3>
                    
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                      gap: '12px'
                    }}>
                      {Object.entries(selectedPlayer.vs_team || {}).map(([team, data]) => (
                        <div 
                          key={team}
                          onClick={() => setSelectedOpponent(team)}
                          style={{
                            background: selectedOpponent === team 
                              ? 'rgba(0,255,200,0.1)' 
                              : 'rgba(0,0,0,0.2)',
                            border: selectedOpponent === team 
                              ? '1px solid rgba(0,255,200,0.3)' 
                              : '1px solid rgba(255,255,255,0.05)',
                            borderRadius: '8px',
                            padding: '12px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <div style={{ 
                            fontWeight: '600', 
                            color: '#fff',
                            marginBottom: '4px'
                          }}>
                            vs {team}
                          </div>
                          <div style={{ 
                            fontSize: '11px', 
                            color: '#888',
                            fontFamily: "'JetBrains Mono', monospace"
                          }}>
                            {data.games}G • {data.PTS} PPG
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'impact' && (
                <div>
                  <div style={{
                    background: 'linear-gradient(135deg, rgba(255,170,0,0.1) 0%, rgba(100,50,0,0.1) 100%)',
                    border: '1px solid rgba(255,170,0,0.3)',
                    borderRadius: '12px',
                    padding: '20px',
                    marginBottom: '24px'
                  }}>
                    <h3 style={{ 
                      fontSize: '16px', 
                      fontWeight: '600', 
                      color: '#ffaa00',
                      marginTop: 0,
                      marginBottom: '8px'
                    }}>
                      🎯 Player Impact Analysis
                    </h3>
                    <p style={{ 
                      fontSize: '13px', 
                      color: '#ccc',
                      margin: 0,
                      lineHeight: '1.6'
                    }}>
                      When <strong>{selectedPlayer.player_name}</strong> doesn't play, how do teammates' 
                      stats change? Critical data for injury-adjusted props.
                    </p>
                  </div>
                  
                  {impactData ? (
                    <>
                      <div style={{
                        display: 'flex',
                        gap: '12px',
                        marginBottom: '20px'
                      }}>
                        <div style={{
                          background: 'rgba(20,25,30,0.8)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          padding: '16px',
                          textAlign: 'center'
                        }}>
                          <div style={{ fontSize: '11px', color: '#888' }}>GAMES MISSED</div>
                          <div style={{ 
                            fontSize: '28px', 
                            fontWeight: '600',
                            fontFamily: "'JetBrains Mono', monospace",
                            color: '#ff4444'
                          }}>
                            {impactData.games_missed}
                          </div>
                        </div>
                      </div>
                      
                      <h4 style={{ 
                        fontSize: '13px', 
                        color: '#888',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        marginBottom: '16px'
                      }}>
                        Teammate Stat Changes (Without {selectedPlayer.player_name.split(' ')[0]})
                      </h4>
                      
                      {impactData.teammates.map((teammate, i) => (
                        <ImpactCard key={i} teammate={teammate} />
                      ))}
                    </>
                  ) : (
                    <div style={{
                      background: 'rgba(20,25,30,0.8)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      padding: '40px',
                      textAlign: 'center',
                      color: '#888'
                    }}>
                      No impact data available - player hasn't missed games this season
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      
      {/* Footer */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '20px 24px',
        marginTop: '40px',
        textAlign: 'center',
        fontSize: '12px',
        color: '#666'
      }}>
        <div>Data updates every 15 minutes • Historical data from NBA Stats API</div>
        <div style={{ marginTop: '8px', color: '#444' }}>
          For entertainment purposes only • Always gamble responsibly
        </div>
      </footer>
    </div>
  );
}
