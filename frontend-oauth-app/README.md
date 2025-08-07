# Frontend OAuth App

This project is a simple frontend application that allows users to sign in using their Google account and grant access to their calendar. Upon successful sign-in, users will receive a thank you message and a summary of pre-call preparations will be sent to their email.

## Project Structure

```
frontend-oauth-app
├── public
│   └── index.html         # Main HTML file for the application
├── src
│   ├── App.tsx            # Main component of the application
│   ├── components
│   │   └── GoogleSignInButton.tsx  # Component for Google sign-in button
│   └── styles
│       └── App.css        # Styles for the application
├── package.json            # npm configuration file
├── tsconfig.json           # TypeScript configuration file
└── README.md               # Project documentation
```

## Setup Instructions

1. **Clone the repository:**
   ```
   git clone <repository-url>
   cd frontend-oauth-app
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Create a Google API project:**
   - Go to the [Google Developer Console](https://console.developers.google.com/).
   - Create a new project and enable the Google Calendar API.
   - Create OAuth 2.0 credentials and set the redirect URI to your application.

4. **Add your Google Client ID:**
   - Update the `GoogleSignInButton.tsx` component with your Google Client ID.

5. **Run the application:**
   ```
   npm start
   ```

## Usage

- Open your browser and navigate to `http://localhost:3000`.
- Click the "Sign in with Google" button to authenticate.
- Grant access to your calendar.
- After successful sign-in, you will see a thank you message.

## License

This project is licensed under the MIT License.