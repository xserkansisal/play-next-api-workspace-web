// PM2 process definition for serving the production build of this app.
//
// This does NOT build the app. Run `npm run build` first (with
// VITE_API_BASE_URL already set - see README.md, "Deploying to a VM"),
// then start this file with PM2. There is no reverse proxy in front of
// this service; it binds directly to WEB_PORT and must be reachable
// there, and the API's CORS_ORIGIN must be set to this app's origin.
module.exports = {
  apps: [
    {
      name: 'play-next-api-workspace-web',
      // `serve` (installed as a normal dependency) serves the static
      // dist/ directory it is pointed at. `-s` (single-page mode) makes
      // it fall back to index.html for any path it can't find on disk,
      // which is required for client-side routing: without it, a deep
      // link or a browser refresh on any path other than "/" 404s.
      script: 'node_modules/.bin/serve',
      args: ['-s', 'dist', '-l', process.env.WEB_PORT || '4173'],
      cwd: __dirname,
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
      // Log files are kept next to this config rather than PM2's default
      // ~/.pm2/logs so they travel with the deployment and are easy to
      // find without knowing the deploying user's home directory.
      out_file: './logs/web-out.log',
      error_file: './logs/web-error.log',
      time: true,
      // `serve` is a static file server with no in-process state; restart
      // it automatically on crash, but back off if it crashes repeatedly
      // instead of hot-looping.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      // This is a static file server; there's nothing to watch/rebuild.
      watch: false,
    },
  ],
}
