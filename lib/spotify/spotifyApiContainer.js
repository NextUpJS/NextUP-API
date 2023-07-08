const spotifyApiContainer = {
  spotifyApis: {}, // Object to store multiple SpotifyApi instances

  createApiInstance(name, redirectUri) {
    this.spotifyApis[name] = new SpotifyWebApi({
      clientId: '40437cda6ea7440aaaeed66c771ba412',
      clientSecret: '2eab5322cbd146128b211d18c72c516f',
      redirectUri: 'http://localhost:3000/callback',
    });
  },

  getApiInstance(name) {
    return this.spotifyApis[name];
  },
};

// Creating two instances of the SpotifyApi inside the container
spotifyApiContainer.createApiInstance('api1');
spotifyApiContainer.createApiInstance('api2');

// Getting a reference to the SpotifyApi instances from the container
const api1 = spotifyApiContainer.getApiInstance('api1');
const api2 = spotifyApiContainer.getApiInstance('api2');

// You can now use the 'api1' and 'api2' objects to interact with the Spotify API
// For example:
api1
  .searchTracks('some search query')
  .then((data) => {
    console.log('Results from api1:', data);
  })
  .catch((error) => {
    console.error('Error:', error);
  });
