export const authorize = (roles = []) => {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole) {
      return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Login required' });
    }
    if (roles.length > 0 && !roles.includes(userRole)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Insufficient permission' });
    }
    next();
  };
};
