# Media Sharing & Profile Update Guide

## New Features

### 1. **Media Sharing (Click the `+` Button)**

Instead of having separate buttons for photos, you now have a unified media picker with a **`+` button**.

**How to use:**
1. Click the **`+` button** in the input area
2. A popup menu appears with options:
   - 📷 **Photo** — Share images (jpg, png, etc.)
   - 🎥 **Video** — Share video files (mp4, mov, etc.)
   - 🎙️ **Voice** — Share audio/voice recordings (mp3, wav, m4a, etc.)
   - 📄 **Document** — Share files (pdf, doc, docx, txt, xlsx, zip)
   - ✕ **Close** — Close the menu

3. Select a media type
4. Choose the file from your computer
5. The file uploads and sends automatically to the chat

**File Size & Type Support:**
- **Images:** jpg, png, gif, webp
- **Videos:** mp4, mov, avi, mkv
- **Audio:** mp3, wav, m4a, aac, ogg
- **Documents:** pdf, doc, docx, txt, xlsx, zip

### 2. **Profile Persistence & Real-Time Updates**

When you save your profile, **all changes sync immediately** to everyone in the chat:

**What saves:**
- ✅ Username (name)
- ✅ Status message
- ✅ Profile photo
- ✅ Online/Offline status
- ✅ Last seen timestamp

**How to update your profile:**
1. On the left sidebar, enter or edit:
   - Your name in the **"Your name"** field
   - Your status in the **"Status"** field
   - Click on the profile photo to upload a new one
2. Click **"Save profile"** button
3. Everyone in your chat will see the changes immediately

**What happens when you save:**
- Your profile updates in the database
- Everyone sees your new name, status, and photo
- Your profile info appears on chat headers when others chat with you
- Changes persist across browser refreshes and sessions

## Technical Details

### Media Storage Structure
- Images: `media/{chatId}/images/{timestamp}_{filename}`
- Videos: `media/{chatId}/videos/{timestamp}_{filename}`
- Audio: `media/{chatId}/voice/{timestamp}_{filename}`
- Documents: `media/{chatId}/documents/{timestamp}_{filename}`

### Database Message Format
Each message now includes:
```json
{
  "senderEmail": "user@example.com",
  "senderId": "userId",
  "senderName": "John Doe",
  "mediaType": "image|video|audio|document",
  "mediaUrl": "https://firebaseurl.../file",
  "fileName": "original_filename.ext",
  "time": 1234567890,
  "seen": false
}
```

### Profile Database Structure
```json
{
  "users": {
    "userId": {
      "username": "John Doe",
      "status": "Available",
      "photo": "https://firebaseurl.../photo.jpg",
      "email": "john@example.com",
      "phone": "+15551234567",
      "online": true,
      "lastSeen": 1234567890
    }
  }
}
```

## Troubleshooting

**Q: Media picker button not working?**
- Make sure the `+` button is visible in the input area
- Check browser console for errors (F12)
- Refresh the page

**Q: File not uploading?**
- Check file size (very large files may timeout)
- Verify you have internet connection
- Check Firebase Storage is enabled in your project
- Ensure file type is supported

**Q: Profile changes not showing?**
- Click "Save profile" and wait for the confirmation alert
- Refresh the page if changes don't appear
- Check your internet connection

**Q: Can't see other user's profile updates?**
- Make sure they saved their profile (they should see "Profile saved successfully")
- Refresh the chat or switch users and back
- Check the real-time database in Firebase Console

## Browser Compatibility

- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ⚠️ Internet Explorer (not supported)

## Note

Media files are stored in Firebase Storage, which has free tier limits:
- Free tier: 5 GB total storage per month
- Consider setting up Firebase Storage rules for security
