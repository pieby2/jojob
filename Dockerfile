# Multi-runtime Dockerfile: Node.js 22 + Python 3.11 for Job Pilot, career-ops, and ai-job-search
FROM node:22-slim

# Install Python 3, pip, curl, and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/

# Set up Python virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python dependencies for scrapers and ai-job-search
RUN pip install --no-cache-dir \
    python-jobspy \
    pandas \
    beautifulsoup4 \
    requests \
    curl_cffi \
    markdownify

# Set working directory
WORKDIR /app

# Copy package files and install Node dependencies
COPY job-pilot/package*.json ./job-pilot/
RUN cd job-pilot && npm install --production

# Copy all projects
COPY career-ops ./career-ops
COPY ai-job-search ./ai-job-search
COPY job-pilot ./job-pilot

# Install career-ops dependencies
RUN cd career-ops && npm install --production

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

WORKDIR /app/job-pilot

EXPOSE 3000

CMD ["node", "server.mjs"]
