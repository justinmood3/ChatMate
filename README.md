# ChatMate Messaging App

This project is a web-based messaging application built with Firebase, Express, and a frontend chat interface. The app supports user registration, profile management, friend discovery, real-time messaging, and file/media uploads.

## Included documentation

- [REQUIREMENTS.md](REQUIREMENTS.md) — advanced functional and non-functional requirements for the application.

## Core features

- Email/password authentication
- Username validation and unique account setup
- User profiles with display name, status, and photo
- Friend discovery and connection management
- Real-time messaging
- Online/offline presence tracking
- Media upload for images, audio, video, and documents
- Firebase storage integration for uploaded content

## Project structure

- `auth.js` — authentication workflows and validation
- `chat.js` — chat, profile, and user connection features
- `server.js` — file upload and storage backend
- `firebase-config.js` — Firebase client configuration
- `firebase-database.js` — Firebase database operations
- `login.html`, `signup.html`, `chat.html` — interface pages

## Getting started

1. Install dependencies:
   npm install
2. Start the backend server:
   npm start
3. Open the app in the browser and configure Firebase settings as needed.

## Notes

This application is suitable as a strong MVP messaging platform and is documented with a professional requirements specification in [REQUIREMENTS.md](REQUIREMENTS.md).
