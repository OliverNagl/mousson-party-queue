// frontend/script.js

const socket = io();

// Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResultsDiv = document.getElementById('search-results');
const queueDiv = document.getElementById('queue');
const currentTrackName = document.getElementById('current-track-name');

// Hide search results and show queue when the search bar loses focus
searchInput.addEventListener('blur', () => {
  setTimeout(() => {
    searchResultsDiv.style.display = 'none'; // Hide search results
    queueDiv.style.display = 'block'; // Show the queue
  }, 150); // Timeout to allow click event on search results to be registered
});

// Event Listeners
searchBtn.addEventListener('click', searchTracks);

// Listen for clicks outside the search input and results
document.addEventListener('click', (event) => {
  if (!searchInput.contains(event.target) && !searchResultsDiv.contains(event.target)) {
    searchResultsDiv.style.display = 'none'; // Hide search results
    queueDiv.style.display = 'block'; // Show the queue
  }
});

// Socket.io events
socket.on('queueUpdated', (queue) => {
  displayQueue(queue);
});

// Listen for the currently playing song from the server
socket.on('currentlyPlaying', (track) => {
  if (track && track.name && track.artist) {
    currentTrackName.innerText = `Currently playing: ${track.name} by ${track.artist}`;
  } else {
    currentTrackName.innerText = 'Currently playing: None';
  }
});

// Functions

let userVotes = {}; // { songId: true } - Track songs the user has voted on

function searchTracks() {
  const query = searchInput.value;
  console.log(`Searching for tracks with query: ${query}`);
  
  fetch(`/api/search?q=${encodeURIComponent(query)}`)
    .then(response => {
      console.log(`Received response with status: ${response.status}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(tracks => {
      console.log('Received tracks:', tracks);
      displaySearchResults(tracks);
    })
    .catch(error => {
      console.error('Error fetching search results:', error);
      alert('Error fetching search results, ;( Please try again.');
    });
}

searchInput.addEventListener('focus', () => {
  // Show the search results container when the search input is focused
  searchResultsDiv.style.display = 'block';
  queueDiv.style.display = 'none'; // Optionally hide the queue container while searching
});

function displaySearchResults(tracks) {
  searchResultsDiv.innerHTML = '';
  tracks.forEach(track => {
    const trackDiv = document.createElement('div');
    trackDiv.className = 'song-item';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'song-info';
    infoDiv.innerText = `${track.name} by ${track.artists[0].name}`;

    const addButton = document.createElement('button');
    addButton.innerText = 'Add to Queue';
    addButton.onclick = () => addToQueue(track);

    trackDiv.appendChild(infoDiv);
    trackDiv.appendChild(addButton);
    searchResultsDiv.appendChild(trackDiv);
  });
}

function addToQueue(track) {
  const song = {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: track.artists[0].name,
    votes: 0
  };

  fetch('/api/queue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(song)
  });
}

function displayQueue(queue) {
  queueDiv.innerHTML = '';
  queue.forEach((song) => {
    const songDiv = document.createElement('div');
    songDiv.className = 'song-item';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'song-info';
    infoDiv.innerText = `${song.name} by ${song.artist} - Votes: ${song.votes}`;

    const voteDiv = document.createElement('div');
    voteDiv.className = 'vote-buttons';

    const upvoteBtn = document.createElement('button');
    upvoteBtn.innerText = 'Upvote';
    upvoteBtn.disabled = userVotes[song.id]; // Disable if already voted
    upvoteBtn.onclick = () => voteSong(song.id, 1, upvoteBtn, downvoteBtn);

    const downvoteBtn = document.createElement('button');
    downvoteBtn.innerText = 'Downvote';
    downvoteBtn.disabled = userVotes[song.id]; // Disable if already voted
    downvoteBtn.onclick = () => voteSong(song.id, -1, upvoteBtn, downvoteBtn);

    voteDiv.appendChild(upvoteBtn);
    voteDiv.appendChild(downvoteBtn);

    songDiv.appendChild(infoDiv);
    songDiv.appendChild(voteDiv);
    queueDiv.appendChild(songDiv);
  });
}

function voteSong(songId, vote, upvoteBtn, downvoteBtn) {
  fetch('/api/vote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ songId, vote })
  })
    .then(response => {
      if (response.ok) {
        userVotes[songId] = true;
        upvoteBtn.disabled = true;
        downvoteBtn.disabled = true;
      } else {
        return response.text().then(text => {
          alert(text);
        });
      }
    })
    .catch(error => {
      console.error('Error voting on song:', error);
    });
}
