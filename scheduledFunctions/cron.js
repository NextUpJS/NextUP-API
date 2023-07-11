const CronJob = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const SpotifyWebApi = require('spotify-web-api-node');

exports.initScheduledJobs = () => {
  const scheduledJobFunction = CronJob.schedule('* * * * * *', async () => {
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
          console.log(`Played next song: ${nextSong.name}`);
        } else {
          console.log(`The queue is empty, no song to play.`);
        }
      } else {
        console.log(`The track '${track.name}' is still playing for event: ${event.id}`);
      }
    }
  });

  scheduledJobFunction.start();
};
