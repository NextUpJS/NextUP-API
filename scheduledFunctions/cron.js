require('dotenv').config();
const CronJob = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const SpotifyWebApi = require('spotify-web-api-node');

exports.initScheduledJobs = () => {
  const scheduledJobFunction = CronJob.schedule(process.env.CRON_TIME, async () => {
    const events = await prisma.event.findMany({
      include: {
        playlist: {
          include: {
            queue: true,
          },
        },
        host: true,
      },
    });

    const spotifyClient = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_SECRET_ID,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    });

    for (const event of events) {
      const now = new Date();
      const lastPlayed = new Date(event.last_queue_item_added);
      const differenceInMinutes = (now - lastPlayed) / 1000 / 60;

      if (differenceInMinutes > 60) {
        await prisma.event.update({
          where: { id: event.id },
          data: {
            active: false,
          },
        });
        console.log(
          `Event ${event.id} has been inactive for more than 60 minutes. Set active to false.`,
        );
        continue;
      }

      spotifyClient.setAccessToken(event.host.spotify_token);

      const playbackState = await spotifyClient.getMyCurrentPlaybackState();

      const track = playbackState.body.item;
      console.log(`Queue: ${JSON.stringify(event.playlist.queue, null, 2)}`);
      if (!track) {
        console.log(`There's no currently playing track for event: ${event.id}`);
      } else if (
        playbackState.body.progress_ms >= track.duration_ms ||
        playbackState.body.progress_ms === 0
      ) {
        console.log(`The track '${track.name}' has ended for event: ${event.id}`);

        // if the queue is not empty, play the next song in the queue
        if (event.playlist.queue.length > 0) {
          const nextSong = event.playlist.queue[0]; // assumes the queue is a list and the next song is at index 0
          console.log(nextSong);
          await spotifyClient.play({ uris: [`spotify:track:${nextSong.trackId}`] });

          // remove the song from the queue
          await prisma.playlist.update({
            where: { id: event.playlist.id },
            data: {
              queue: {
                delete: { id: nextSong.id },
              },
            },
          });
          console.log(`Played next song`);
        } else {
          console.log(`The queue is empty, no song to play.`);

          // Get recommendations based on the last played song
          const recommendations = await spotifyClient.getRecommendations({
            seed_tracks: [track.id],
            min_energy: 0.4,
            min_popularity: 50,
            limit: 20,
          });

          if (recommendations.body.tracks.length > 0) {
            // Select a random track from the recommendations
            const randomIndex = Math.floor(Math.random() * recommendations.body.tracks.length);
            const randomTrack = recommendations.body.tracks[randomIndex];

            // Play the selected random track
            await spotifyClient.play({ uris: [`spotify:track:${randomTrack.id}`] });
            console.log(
              `Played a random recommended song: '${randomTrack.name}' by '${randomTrack.artists[0].name}'`,
            );
          } else {
            console.log(`No recommended tracks found.`);
          }
        }
      } else {
        console.log(`The track '${track.name}' is still playing for event: ${event.id}`);
      }
    }
  });

  scheduledJobFunction.start();
};
