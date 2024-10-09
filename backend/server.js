// backend/server.js

const express = require('express');
const request = require('request');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser'); // Added for user tracking
const { v4: uuidv4 } = require('uuid'); // Added for generating unique user IDs

// Replace with your Spotify app credentials
const client_id = '8e023a72267c4f74b9de04ccede8f811'; // Replace with your Spotify Client ID
const client_secret = '67f48b407fd546d4aad1faa05314e055'; // Replace with your Spotify Client Secret
const redirect_uri = 'https://party-queue-57ab7486e08a.herokuapp.com/callback';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(bodyParser.json());
app.use(cookieParser()); // Use cookie-parser

// Middleware to assign userId to guests
app.use((req, res, next) => {
  if (!req.cookies.userId) {
    res.cookie('userId', uuidv4(), { httpOnly: true });
  }
  next();
});

// In-memory storage

let recentlyPlayed = [];
let access_token = '';
let refresh_token = '';
let expires_in = 0;
let token_timestamp = 0;
let queue = [];
let currentTrack = null;
let isPlaying = false;
let votes = {}; // { userId: { songId: vote } } - For tracking user votes
let playlistId = "051HRJaonkYB1gAIhn3GUJ"; // Store the playlist ID for reuse



const scopes = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'playlist-modify-public',   // Add this for public playlists
  'playlist-modify-private',  // Add this for private playlists
];


// Generate random string for state
function generateRandomString(length) {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Authentication
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  const auth_query_parameters = new URLSearchParams({
    response_type: 'code',
    client_id: client_id,
    scope: scopes.join(' '),
    redirect_uri: redirect_uri,
    state: state,
  });

  res.redirect(
    'https://accounts.spotify.com/authorize/?' +
      auth_query_parameters.toString()
  );
});

app.get('/callback', (req, res) => {
  const code = req.query.code;

  const authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code',
    },
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(client_id + ':' + client_secret).toString('base64'),
    },
    json: true,
  };

  request.post(authOptions, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      access_token = body.access_token;
      refresh_token = body.refresh_token;
      expires_in = body.expires_in;
      token_timestamp = Date.now();

      console.log('Access token acquired:', access_token);
      console.log('Refresh token acquired:', refresh_token); 
      res.redirect('/');
    } else {
      console.error('Authentication failed:', error || body);
      res.send('Authentication failed');
    }
  });
});

// Refresh Access Token
function refreshAccessToken(callback) {
  console.log('Refreshing access token...');
  const authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(client_id + ':' + client_secret).toString('base64'),
    },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
    },
    json: true,
  };

  request.post(authOptions, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      access_token = body.access_token;
      expires_in = body.expires_in;
      token_timestamp = Date.now();

      console.log('Access token refreshed:', access_token);

      if (callback) callback();
    } else {
      console.error('Failed to refresh access token:', error || body);
    }
  });
}

// Check if token is expired
function isTokenExpired() {
  return Date.now() > token_timestamp + expires_in * 1000;
}

// Queue Management
app.get('/api/queue', (req, res) => {
  res.json(queue);
});

app.post('/api/queue', (req, res) => {
  const song = req.body;
  song.votes = 0;

  // Check if the song is already in the queue
  const isSongInQueue = queue.some((queuedSong) => queuedSong.id === song.id);

  if (isSongInQueue) {
    res.status(400).send('This song is already in the queue.');
    return;
  }

  // Check if the song has been played in the last 20 tracks
  if (recentlyPlayed.includes(song.id)) {
    res.status(400).send('This song was recently played and cannot be added to the queue.');
    return;
  }

  queue.push(song);
  updateQueue();
  res.sendStatus(200);

  // If the queue has only one song, start playing
  if (queue.length === 1 && !isPlaying) {
    playNextTrack();
  }
});

app.post('/api/vote', (req, res) => {
  const userId = req.cookies.userId;
  const { songId, vote } = req.body; // vote can be +1 (upvote) or -1 (downvote)

  if (!votes[userId]) {
    votes[userId] = {};
  }

  const song = queue.find((s) => s.id === songId);
  if (!song) {
    res.status(404).send('Song not found.');
    return;
  }

  // Check if the user has already voted on this song
  const previousVote = votes[userId][songId] || 0; // Default to 0 if no previous vote

  // If the user has voted, adjust the song's votes by removing the old vote and adding the new one
  if (previousVote !== 0) {
    song.votes -= previousVote; // Remove the effect of the previous vote
  }

  // Apply the new vote
  song.votes += vote;
  votes[userId][songId] = vote; // Store the user's new vote

  updateQueue();
  res.sendStatus(200);
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.emit('queueUpdated', queue);

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

function updateQueue() {
  // Sort queue based on votes
  queue.sort((a, b) => b.votes - a.votes);
  io.emit('queueUpdated', queue);
}

function playNextTrack() {
  if (queue.length > 0) {
    currentTrack = queue.shift();

    // Add the played track to recentlyPlayed
    if (currentTrack) {
      recentlyPlayed.push(currentTrack.id);
      
      // Ensure we only keep the last 20 songs in recentlyPlayed
      if (recentlyPlayed.length > 20) {
        recentlyPlayed.shift(); // Remove the oldest song ID
      }
    }
    updateQueue();
    playTrack(currentTrack.uri);

    // Add the played track to the playlist
    addToPlaylist(currentTrack.uri);
    

  } else {
    currentTrack = null;
    isPlaying = false;
    console.log('Queue is empty. No track to play.');
  }
}

function addToPlaylist(trackUri) {
  if (!playlistId) {
    console.error("Playlist not available yet. Can't add the track.");
    return;
  }

  const options = {
    url: `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
    headers: { Authorization: "Bearer " + access_token },
    json: {
      uris: [trackUri], // Add the current song to the playlist
    },
  };

  request.post(options, (error, response, body) => {
    if (!error && response.statusCode === 201) {
      console.log("Track added to playlist:", trackUri);
    } else {
      console.error("Error adding track to playlist:", error || body);
    }
  });
}



function playTrack(trackUri) {
  console.log('Preparing to play track:', trackUri);
  if (isTokenExpired()) {
    refreshAccessToken(() => {
      getAvailableDevicesAndPlay(trackUri);
    });
  } else {
    getAvailableDevicesAndPlay(trackUri);
  }
}

let laptopDeviceId;

function getAvailableDevicesAndPlay(trackUri) {
  getAvailableDevices((devices) => {
    // Log available devices
    console.log('Available devices:', devices);

    // Replace 'Laszlos MacBook Air' with your actual device name
    const laptopDevice = devices.find(
      (device) => device.name === 'LAPTOP-CE0GELR1' // Replace this
    );

    if (laptopDevice) {
      laptopDeviceId = laptopDevice.id;
      console.log('Laptop device ID:', laptopDeviceId);
      sendPlayRequest(trackUri, laptopDeviceId);
    } else {
      console.error(
        'Laptop device not found. Please ensure Spotify is open on your laptop.'
      );
    }
  });
}

function sendPlayRequest(trackUri, deviceId) {
  console.log('Sending play request to device:', deviceId);
  const options = {
    url: `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
    headers: { Authorization: 'Bearer ' + access_token },
    json: {
      uris: [trackUri],
    },
  };

  request.put(options, (error, response, body) => {
    if (!error) {
      if (response.statusCode === 204) {
        isPlaying = true;
        console.log('Playback started for track:', trackUri);
      } else {
        console.error(
          `Error playing track (status ${response.statusCode}):`,
          body || response.statusMessage
        );
      }
    } else {
      console.error('Error playing track:', error);
    }
  });
}

// Monitor Playback State
setInterval(() => {
  if (isPlaying && currentTrack) {
    if (isTokenExpired()) {
      refreshAccessToken(checkPlaybackState);
    } else {
      checkPlaybackState();
    }
  }
}, 5000);

function checkPlaybackState() {
  console.log('Checking playback state...');
  const options = {
    url: 'https://api.spotify.com/v1/me/player/currently-playing',
    headers: { Authorization: 'Bearer ' + access_token },
    json: true,
  };

  request.get(options, (error, response, body) => {
    if (!error && response.statusCode === 200 && body && body.item) {
      const remainingTime =
        body.item.duration_ms - body.progress_ms;
      console.log(
        `Current track progress: ${body.progress_ms} / ${body.item.duration_ms} ms`
      );
      if (remainingTime <= 5000) {
        console.log('Less than 5 seconds remaining. Playing next track.');
        playNextTrack();
      }
    } else {
      console.error('Error fetching playback state:', error || body);
    }
  });
}

// Search Endpoint
app.get('/api/search', (req, res) => {
  const query = req.query.q;

  function searchSpotify() {
    const options = {
      url: `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=track&limit=10`,
      headers: { Authorization: 'Bearer ' + access_token },
      json: true,
    };

    request.get(options, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        res.json(body.tracks.items);
      } else {
        console.error('Error in searchSpotify:', error || body);
        res.status(response.statusCode).send(body || error);
      }
    });
  }

  if (isTokenExpired()) {
    refreshAccessToken(() => {
      searchSpotify();
    });
  } else {
    searchSpotify();
  }
});

function getAvailableDevices(callback) {
  const options = {
    url: 'https://api.spotify.com/v1/me/player/devices',
    headers: { Authorization: 'Bearer ' + access_token },
    json: true,
  };

  request.get(options, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      callback(body.devices);
    } else {
      console.error('Error fetching devices:', error || body);
      callback([]);
    }
  });
}

// Start the server
const PORT = process.env.PORT || 8888;
const HOST = '0.0.0.0'; // Listen on all network interfaces

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});