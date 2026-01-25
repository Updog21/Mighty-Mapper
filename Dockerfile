FROM node:20-alpine

# Install Python, PostgreSQL client, git, and dependencies needed for scripts
# - python3/pip: For db:seed script (extract_mitre_data.py)
# - postgresql-client: For pg_dump backups via admin API
# - git: For cloning Sigma rules repository
RUN apk add --no-cache python3 py3-pip postgresql-client git && \
    pip3 install requests mitreattack-python --break-system-packages

WORKDIR /app

# Clone rules repositories for local rule matching (avoids GitHub API rate limits)
RUN git clone --depth 1 --single-branch --filter=blob:none https://github.com/SigmaHQ/sigma.git /app/data/sigma && \
    git clone --depth 1 --single-branch --filter=blob:none https://github.com/splunk/security_content.git /app/data/splunk-security-content && \
    git clone --depth 1 --single-branch --filter=blob:none https://github.com/elastic/detection-rules.git /app/data/elastic-detection-rules && \
    git clone --depth 1 --single-branch --filter=blob:none https://github.com/center-for-threat-informed-defense/mappings-explorer.git /app/data/ctid-mappings-explorer && \
    git clone --filter=blob:none --sparse https://github.com/Azure/Azure-Sentinel.git /app/data/azure-sentinel && \
    git -C /app/data/azure-sentinel sparse-checkout set --no-cone 'Solutions/**/Analytic Rules/**'

COPY package*.json ./
RUN npm install --package-lock-only --no-audit --no-fund
RUN npm install --no-audit --no-fund

# Copy configuration files
COPY drizzle.config.ts ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY vite-plugin-meta-images.ts ./
COPY postcss.config.js ./
COPY components.json ./

# Copy source directories
COPY shared ./shared
COPY script ./script
COPY scripts ./scripts
COPY server ./server
COPY client ./client
COPY mappings ./mappings
COPY script/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN npm run build

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

RUN chmod +x /app/docker-entrypoint.sh

CMD ["/app/docker-entrypoint.sh"]
