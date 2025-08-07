import React from 'react';

const GoogleSignInButton: React.FC = () => {
    const handleSignIn = () => {
        const CLIENT_ID = '1026423440828-80cg92keul3jhm7skm06nkmt7laqi4te.apps.googleusercontent.com';
        const REDIRECT_URI = 'http://localhost:3001/oauth2callback';
        const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=token&scope=${SCOPE}`;

        window.location.href = authUrl;
    };

    return (
        <button onClick={handleSignIn} className="google-sign-in-button">
            Sign in with Google
        </button>
    );
};

export default GoogleSignInButton;