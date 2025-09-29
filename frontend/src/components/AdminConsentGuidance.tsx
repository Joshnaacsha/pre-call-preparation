import React from 'react';
import {
  Box,
  Button,
  Container,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Alert,
  AlertTitle,
  Divider
} from '@mui/material';
import {
  AdminPanelSettings,
  CalendarMonth,
  Email,
  Person,
  Security,
  ContentCopy
} from '@mui/icons-material';

interface AdminConsentGuidanceProps {
  adminConsentUrl?: string;
  onClose?: () => void;
}

export const AdminConsentGuidance: React.FC<AdminConsentGuidanceProps> = ({
  adminConsentUrl,
  onClose
}) => {
  const handleCopyUrl = () => {
    if (adminConsentUrl) {
      navigator.clipboard.writeText(adminConsentUrl);
    }
  };

  return (
    <Container maxWidth="md">
      <Paper elevation={3} sx={{ p: 4, mt: 4 }}>
        <Typography variant="h4" gutterBottom color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <AdminPanelSettings fontSize="large" />
          Administrator Approval Required
        </Typography>

        <Alert severity="info" sx={{ mt: 2, mb: 3 }}>
          <AlertTitle>Action Required</AlertTitle>
          This application needs approval from your organization's IT administrator to access
          Microsoft 365 features.
        </Alert>

        <Typography variant="h6" gutterBottom color="textSecondary" sx={{ mt: 4 }}>
          Required Permissions:
        </Typography>

        <List>
          <ListItem>
            <ListItemIcon>
              <CalendarMonth color="primary" />
            </ListItemIcon>
            <ListItemText 
              primary="Calendar Access" 
              secondary="Read calendar events to prepare for meetings"
            />
          </ListItem>
          
          <ListItem>
            <ListItemIcon>
              <Email color="primary" />
            </ListItemIcon>
            <ListItemText 
              primary="Email Access" 
              secondary="Send meeting briefings to team members"
            />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Person color="primary" />
            </ListItemIcon>
            <ListItemText 
              primary="User Profile" 
              secondary="Access basic user information"
            />
          </ListItem>

          <ListItem>
            <ListItemIcon>
              <Security color="primary" />
            </ListItemIcon>
            <ListItemText 
              primary="Offline Access" 
              secondary="Maintain secure access between sessions"
            />
          </ListItem>
        </List>

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>
          Next Steps:
        </Typography>

        <List sx={{ mb: 4 }}>
          <ListItem>
            <ListItemText 
              primary="1. Contact Your IT Administrator" 
              secondary="Forward them the admin consent URL below"
            />
          </ListItem>
          <ListItem>
            <ListItemText 
              primary="2. Provide Justification" 
              secondary="Explain that this app helps prepare for client meetings by accessing calendar and sending briefings"
            />
          </ListItem>
          <ListItem>
            <ListItemText 
              primary="3. Wait for Approval" 
              secondary="Once approved, you can sign in and use the application"
            />
          </ListItem>
        </List>

        {adminConsentUrl && (
          <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
            <Typography variant="subtitle2" color="textSecondary" gutterBottom>
              Admin Consent URL:
            </Typography>
            <Typography 
              variant="body2" 
              sx={{ 
                wordBreak: 'break-all',
                fontFamily: 'monospace',
                bgcolor: 'background.paper',
                p: 2,
                borderRadius: 1
              }}
            >
              {adminConsentUrl}
            </Typography>
            <Button
              startIcon={<ContentCopy />}
              onClick={handleCopyUrl}
              variant="outlined"
              size="small"
              sx={{ mt: 2 }}
            >
              Copy URL
            </Button>
          </Box>
        )}

        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            variant="contained"
            color="primary"
            href={adminConsentUrl}
            target="_blank"
          >
            Open Admin Consent Page
          </Button>
        </Box>
      </Paper>
    </Container>
  );
};

export default AdminConsentGuidance;