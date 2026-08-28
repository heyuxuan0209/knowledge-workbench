import { timingSafeEqual } from 'node:crypto';

const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());

const safeEqual = (actual, expected) => {
  const a = Buffer.from(String(actual));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
};

export function parseAllowedOrigins(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

export function createCorsOptions(env = process.env) {
  const allowed = new Set(parseAllowedOrigins(env.ALLOWED_ORIGINS));
  const development = env.NODE_ENV !== 'production';
  return {
    credentials: true,
    origin(origin, callback) {
      // curl/systemd probes and same-origin browser requests do not send Origin.
      if (!origin || allowed.has(origin) || (development && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
        callback(null, true);
      } else {
        callback(new Error('Origin not allowed'));
      }
    },
  };
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function createAccessProtection(env = process.env) {
  const enabled = truthy(env.ACCESS_PROTECTION_ENABLED);
  if (!enabled) return (_req, _res, next) => next();

  const username = env.ACCESS_USERNAME || '';
  const password = env.ACCESS_PASSWORD || '';
  if (!username || !password) {
    throw new Error('ACCESS_PROTECTION_ENABLED=true requires ACCESS_USERNAME and ACCESS_PASSWORD');
  }

  const failures = new Map();
  const windowMs = 10 * 60 * 1000;
  const maxFailures = 20;

  return (req, res, next) => {
    // Minimal liveness reveals no data or version and remains usable by external monitors.
    if (req.path === '/health/live') return next();

    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const state = failures.get(key);
    if (state && state.resetAt > now && state.count >= maxFailures) {
      res.setHeader('Retry-After', String(Math.ceil((state.resetAt - now) / 1000)));
      return res.status(429).json({ status: 'error', error: 'Too many authentication attempts' });
    }
    if (state && state.resetAt <= now) failures.delete(key);

    const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
    let suppliedUser = '';
    let suppliedPassword = '';
    if (scheme === 'Basic' && encoded) {
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const splitAt = decoded.indexOf(':');
        if (splitAt >= 0) {
          suppliedUser = decoded.slice(0, splitAt);
          suppliedPassword = decoded.slice(splitAt + 1);
        }
      } catch { /* malformed credentials are handled as an auth failure */ }
    }

    if (safeEqual(suppliedUser, username) && safeEqual(suppliedPassword, password)) {
      failures.delete(key);
      res.setHeader('Cache-Control', 'private, no-store');
      return next();
    }

    const current = failures.get(key);
    failures.set(key, current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + windowMs });
    res.setHeader('WWW-Authenticate', 'Basic realm="Knowledge Workbench", charset="UTF-8"');
    return res.status(401).json({ status: 'error', error: 'Authentication required' });
  };
}
