import jwt from 'jsonwebtoken';

export const requireAuth = (req, res, next) => {
  // Try to get token from cookie first, then from Authorization header
  let token = req.cookies?.token;
  
  // If no cookie, check Authorization header (Bearer token)
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
    }
  }
  
  if (!token) return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Login required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role, email, name }
    return next();
  } catch (e) {
    return res.status(401).json({ code: 'INVALID_TOKEN', message: 'Invalid session' });
  }
};
