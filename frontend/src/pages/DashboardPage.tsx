import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function DashboardPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/projects', { replace: true });
  }, [navigate]);
  return null;
}
