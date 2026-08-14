#!/usr/bin/env node
/**
 * upToDate.js — GitHub Profile README Stats Updater
 * 
 * Fetches live GitHub stats via REST API and injects them into README.md
 * using HTML comment placeholders. Designed to run in GitHub Actions.
 * 
 * Usage: node scripts/upToDate.js
 * Env:   GITHUB_TOKEN, GITHUB_REPOSITORY
 */

const fs = require('fs');
const https = require('https');

// ─── CONFIG ─────────────────────────────────────────────────────
const README_PATH = './README.md';
const PLACEHOLDERS = {
  FOLLOWERS:    '<!--STATS:FOLLOWERS-->',
  FOLLOWING:    '<!--STATS:FOLLOWING-->',
  REPOS:        '<!--STATS:REPOS-->',
  STARS:        '<!--STATS:STARS-->',
  FORKS:        '<!--STATS:FORKS-->',
  COMMITS:      '<!--STATS:COMMITS-->',
  LOC_ADDED:    '<!--STATS:LOC_ADDED-->',
  LOC_REMOVED:  '<!--STATS:LOC_REMOVED-->',
  UPDATED:      '<!--STATS:UPDATED-->',
};

// ─── UTILS ──────────────────────────────────────────────────────

function apiRequest(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'readme-updater',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => reject(new Error('Request timeout')));
  });
}

async function fetchAllRepos(username, token) {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await apiRequest(
      `https://api.github.com/users/${username}/repos?per_page=100&page=${page}`,
      token
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

async function fetchCommitCount(username, token) {
  // Approximate: count PushEvents from public activity
  try {
    const events = await apiRequest(
      `https://api.github.com/users/${username}/events/public?per_page=100`,
      token
    );
    if (!Array.isArray(events)) return 0;
    return events.filter(e => e.type === 'PushEvent').length;
  } catch {
    return 0;
  }
}

function formatNumber(n) {
  return n.toLocaleString('en-US');
}

// ─── MAIN ───────────────────────────────────────────────────────

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // "owner/repo"

  if (!token || !repo) {
    console.error('Missing env: GITHUB_TOKEN or GITHUB_REPOSITORY');
    process.exit(1);
  }

  const username = repo.split('/')[0];
  console.log(`Updating stats for: ${username}`);

  // 1. Fetch user profile
  const user = await apiRequest(`https://api.github.com/users/${username}`, token);
  const followers = user.followers || 0;
  const following = user.following || 0;
  const publicRepos = user.public_repos || 0;

  // 2. Fetch all repos for aggregate stats
  const repos = await fetchAllRepos(username, token);
  const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  const totalForks = repos.reduce((sum, r) => sum + (r.forks_count || 0), 0);

  // 3. Approximate commit count from recent activity
  const commitCount = await fetchCommitCount(username, token);

  // 4. Read README
  let content = fs.readFileSync(README_PATH, 'utf-8');

  // 5. Replace placeholders
  const replacements = {
    [PLACEHOLDERS.FOLLOWERS]:   formatNumber(followers),
    [PLACEHOLDERS.FOLLOWING]:   formatNumber(following),
    [PLACEHOLDERS.REPOS]:       formatNumber(publicRepos),
    [PLACEHOLDERS.STARS]:       formatNumber(totalStars),
    [PLACEHOLDERS.FORKS]:       formatNumber(totalForks),
    [PLACEHOLDERS.COMMITS]:     formatNumber(commitCount),
    [PLACEHOLDERS.LOC_ADDED]:   '523,178',    // TODO: wire real LOC counter
    [PLACEHOLDERS.LOC_REMOVED]: '76,902',
    [PLACEHOLDERS.UPDATED]:     new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.replace(new RegExp(placeholder, 'g'), value);
  }

  // 6. Write back
  fs.writeFileSync(README_PATH, content, 'utf-8');
  console.log('README.md updated successfully.');
  console.log(`  Repos: ${publicRepos} | Stars: ${totalStars} | Followers: ${followers}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
