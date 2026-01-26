# Docker Deployment Guide

This guide covers deploying Courtside Edge using Docker and Docker Compose.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 2GB available RAM
- 10GB available disk space

## Quick Start

### Development Environment

1. **Start all services:**
   ```bash
   docker-compose up -d
   ```

2. **Check status:**
   ```bash
   docker-compose ps
   ```

3. **View logs:**
   ```bash
   docker-compose logs -f app
   ```

4. **Access the application:**
   - Application: http://localhost:5000
   - pgAdmin (if enabled): http://localhost:5050

5. **Stop services:**
   ```bash
   docker-compose down
   ```

### Production Deployment

1. **Build the production image:**
   ```bash
   docker build -t courtside-edge:latest .
   ```

2. **Run with production environment:**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL=postgresql://courtside_edge_user:secure_password@postgres:5432/courtside_edge

# Application
NODE_ENV=production
PORT=5000

# API Keys
BALLDONTLIE_API_KEY=your_key_here
ODDS_API_KEY=your_key_here
```

### Using Docker Compose Profiles

Start specific services:

```bash
# Start only app and database
docker-compose up app postgres

# Start with development tools (pgAdmin)
docker-compose --profile dev up
```

## Service Management

### Database Initialization

The database is automatically initialized on first run. To manually run migrations:

```bash
# Enter the database container
docker-compose exec postgres psql -U courtside_edge_user -d courtside_edge

# Or run migrations from host
docker-compose exec postgres psql -U courtside_edge_user -d courtside_edge -f /docker-entrypoint-initdb.d/setup.sql
```

### Backup Database

```bash
# Create backup
docker-compose exec postgres pg_dump -U courtside_edge_user courtside_edge > backup_$(date +%Y%m%d).sql

# Restore backup
docker-compose exec -T postgres psql -U courtside_edge_user courtside_edge < backup_20240115.sql
```

### View Application Logs

```bash
# All logs
docker-compose logs

# Specific service
docker-compose logs app
docker-compose logs postgres

# Follow logs
docker-compose logs -f app

# Last 100 lines
docker-compose logs --tail=100 app
```

### Execute Commands in Container

```bash
# Open shell in app container
docker-compose exec app sh

# Run npm commands
docker-compose exec app npm run db:push

# Check application health
docker-compose exec app wget -qO- http://localhost:5000/api/health
```

## Scaling

### Horizontal Scaling

To run multiple application instances:

```bash
docker-compose up --scale app=3
```

**Note:** You'll need a load balancer (nginx, traefik) in front of the app instances.

### Resource Limits

Add resource limits to `docker-compose.yml`:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

## Monitoring

### Health Checks

Check health status:

```bash
# Using Docker
docker inspect courtside-edge-app | grep -A 10 Health

# Using curl
curl http://localhost:5000/api/health
```

### Resource Usage

```bash
# View resource usage
docker stats courtside-edge-app courtside-edge-db

# Detailed inspection
docker inspect courtside-edge-app
```

## Troubleshooting

### Container Won't Start

**Check logs:**
```bash
docker-compose logs app
```

**Common issues:**
- Database not ready → Wait for postgres healthcheck
- Port already in use → Change port in docker-compose.yml
- Permission errors → Check file ownership

### Database Connection Issues

**Test connection:**
```bash
docker-compose exec app sh -c 'echo $DATABASE_URL'
docker-compose exec postgres pg_isready -U courtside_edge_user
```

**Reset database:**
```bash
docker-compose down -v  # ⚠️ This deletes all data!
docker-compose up postgres -d
```

### Out of Disk Space

**Clean up:**
```bash
# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Remove everything stopped
docker system prune -a
```

### Application Performance Issues

**Check resource usage:**
```bash
docker stats courtside-edge-app
```

**Increase memory:**
```yaml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 2G
```

## Production Considerations

### Security

1. **Use secrets for sensitive data:**
   ```yaml
   services:
     app:
       secrets:
         - db_password

   secrets:
     db_password:
       file: ./secrets/db_password.txt
   ```

2. **Run as non-root user** (already configured in Dockerfile)

3. **Use read-only file systems where possible:**
   ```yaml
   services:
     app:
       read_only: true
       tmpfs:
         - /tmp
   ```

4. **Enable SSL/TLS for database connections**

### Networking

Create an external network for production:

```bash
docker network create --driver bridge courtside-edge-prod

# In docker-compose.yml
networks:
  default:
    external:
      name: courtside-edge-prod
```

### Automated Backups

Add a backup service to `docker-compose.yml`:

```yaml
services:
  backup:
    image: postgres:15-alpine
    depends_on:
      - postgres
    volumes:
      - ./backups:/backups
    environment:
      PGPASSWORD: courtside_edge_dev_password
    entrypoint: |
      sh -c 'while true; do
        pg_dump -h postgres -U courtside_edge_user courtside_edge > /backups/backup_$$(date +%Y%m%d_%H%M%S).sql
        find /backups -name "backup_*.sql" -mtime +7 -delete
        sleep 86400
      done'
```

### Logging

Configure log drivers:

```yaml
services:
  app:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Or use a centralized logging system:

```yaml
services:
  app:
    logging:
      driver: "syslog"
      options:
        syslog-address: "tcp://logs.example.com:514"
```

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build Docker image
        run: docker build -t courtside-edge:${{ github.sha }} .

      - name: Push to registry
        run: |
          echo ${{ secrets.DOCKER_PASSWORD }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
          docker push courtside-edge:${{ github.sha }}

      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /app/courtside-edge
            docker-compose pull
            docker-compose up -d
```

## Cloud Deployment

### AWS ECS

1. Push image to ECR
2. Create task definition
3. Create ECS service
4. Use RDS for PostgreSQL

### DigitalOcean App Platform

```bash
# Create app
doctl apps create --spec .do/app.yaml
```

### Railway

```bash
# Link project
railway link

# Deploy
railway up
```

### Render

Connect your GitHub repository and use `render.yaml` for configuration.

## Support

For issues or questions:
- Docker Hub: https://hub.docker.com/
- Docker Docs: https://docs.docker.com/
- Project Issues: https://github.com/yourusername/courtside-edge/issues
