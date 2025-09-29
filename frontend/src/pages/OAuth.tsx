import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AdminConsentGuidance } from '../components/AdminConsentGuidance';
import {
  Container,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  AlertTitle,
} from '@mui/material';

const OAuth: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [adminConsentUrl, setAdminConsentUrl] = useState<string>();

  useEffect(() => {
    const auth = searchParams.get('auth');
    const errorType = searchParams.get('error_type');
    const message = searchParams.get('message');

    if (auth === 'success') {
      // Redirect to dashboard on success
      navigate('/dashboard');
    } else if (errorType === 'admin_consent_required') {
      // Fetch admin consent URL
      fetch('http://localhost:3001/api/admin-consent-url')
        .then(response => response.json())
        .then(data => {
          setAdminConsentUrl(data.adminConsentUrl);
        })
        .catch(error => {
          console.error('Error fetching admin consent URL:', error);
        });
    }
  }, [searchParams, navigate]);

  const handleClose = () => {
    navigate('/');
  };

  // Show loading state while checking auth status
  if (!searchParams.get('auth')) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  // Handle error cases
  if (searchParams.get('auth') === 'error') {
    const errorType = searchParams.get('error_type');
    
    // Show admin consent guidance for admin consent required error
    if (errorType === 'admin_consent_required') {
      return <AdminConsentGuidance adminConsentUrl={adminConsentUrl} onClose={handleClose} />;
    }

    // Show generic error for other cases
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="error">
          <AlertTitle>Authentication Error</AlertTitle>
          {searchParams.get('message') || 'An error occurred during authentication'}
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h5" gutterBottom>
          Authentication Successful
        </Typography>
        <Typography color="textSecondary">
          Redirecting to dashboard...
        </Typography>
      </Paper>
    </Container>
  );
};

export default OAuth;