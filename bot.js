const fs = require('fs');
const glob = require('glob');
const readline = require('readline');
const { Client, Intents } = require('discord.js');
const moment = require('moment');

// Read the configuration from the config.json file
const config = JSON.parse(fs.readFileSync('./config.json'));

// Destructure the configuration options
const { token, channelId, filetype, filepath } = config;

// Create a new Discord client
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

client.once('ready', () => {
  console.log(`Bot connected as ${client.user.tag}`);
});

//////////////////////////////////////////////////////////////////////////////////////////////
// -- /search-keyword command
//////////////////////////////////////////////////////////////////////////////////////////////

client.on('messageCreate', async (message) => {
  if (message.channel.id !== channelId) return;

  if (!message.content.startsWith('/search-keyword')) return;

  const args = message.content.split(' ');

  if (args.length !== 5) {
    return message.channel.send('Incorrect format. Please use "/search-log <date> <time start> <time end> <keyword>"');
  }

  const [command, date, timeStart, timeEnd, keyword] = args;
  console.log(`Command received: ${command} Date: ${date} Start: ${timeStart} End: ${timeEnd} Keyword: ${keyword}`);

  console.log("Starting search in log files...");
  const searchStart = moment(`${date} ${timeStart}`, 'DD.MM.YYYY HH:mm');
  const searchEnd = moment(`${date} ${timeEnd}`, 'DD.MM.YYYY HH:mm');

  const files = glob.sync(`${filepath}/**/*${filetype}`);

  let searchResults = [];

  for (const file of files) {
    console.log(`Searching in file: ${file}`);
    const fileStream = fs.createReadStream(file);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let lineNumber = 0;
    let logDate = '';

    for await (const line of rl) {
      lineNumber++;

      if (lineNumber === 4) {
        logDate = moment(line.split('on')[1].trim(), 'YYYY-MM-DD HH:mm:ss').format('DD.MM.YYYY');
      }

      let eventTime = moment(`${logDate} ${line.split(' | ')[0]}`, 'DD.MM.YYYY HH:mm:ss');
      if (!eventTime.isBetween(searchStart, searchEnd)) continue;

      if (line.includes(keyword)) {
        searchResults.push({
          date: logDate,
          time: eventTime,
          log: line
        });
      }
    }
  }

  searchResults.sort((a, b) => a.time.isBefore(b.time) ? -1 : 1);
  const formattedResults = searchResults.map(result => `${result.date} | ${result.log}`);

  if (formattedResults.length > 0) {
    let messageChunks = formattedResults.join('\n').match(/[\s\S]{1,1900}/g);
    let maxMessages = 5;

    for (let i = 0; i < messageChunks.length && i < maxMessages; i++) {
      message.channel.send(messageChunks[i]);
    }

    // If there were more messages to be sent, inform the user to narrow the time window
    if (messageChunks.length > maxMessages) {
      message.channel.send(`There are more log entries found. Please narrow your search by adjusting the time frame.`);
    }
  } else {
    message.channel.send(`No results found for keyword '${keyword}' between ${timeStart} and ${timeEnd} on ${date}.`);
  }
});

//////////////////////////////////////////////////////////////////////////////////////////////
// -- /search-radius command
//////////////////////////////////////////////////////////////////////////////////////////////

client.on('messageCreate', async (message) => {
  // Only listen to messages in the desired channel
  if (message.channel.id !== channelId) return;

  if (message.content.startsWith('/search-radius')) {
    // Split the message by spaces to parse the attributes
    const args = message.content.split(' ');

    // If not enough arguments, return an error message
    if (args.length !== 7) {
      return message.channel.send('Incorrect format. Please use "/search-radius <date> <time start> <time end> <x> <y> <radius>"');
    }

    // Parse the attributes
    const [command, date, timeStart, timeEnd, x, y, radius] = args;
    console.log(`Command received: ${command} Date: ${date} Start: ${timeStart} End: ${timeEnd} X: ${x} Y: ${y} Radius: ${radius}`);

    console.log("Starting search in log files...");
    const searchStart = moment(`${date} ${timeStart}`, 'DD.MM.YYYY HH:mm');
    const searchEnd = moment(`${date} ${timeEnd}`, 'DD.MM.YYYY HH:mm');

    // Check if the provided radius exceeds the maximum limit
    const maxRadius = 100;
    if (radius > maxRadius) {
      return message.channel.send(`The maximum radius allowed is ${maxRadius}. Please choose a smaller radius.`);
    }

    // Search for all files that match the file type in the provided directory and subdirectories
    const files = glob.sync(`${filepath}/**/*${filetype}`);

    let searchResults = [];

    // Iterate over each file
    for (const file of files) {
      console.log(`Searching in file: ${file}`);
      // Create a read stream for each file
      const fileStream = fs.createReadStream(file);

      // Create an interface to read the file line by line
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let lineNumber = 0;
      let logDate = '';

      // Asynchronously iterate over each line of the file
      for await (const line of rl) {
        lineNumber++;

        // Parse the file date from the 4th line
        if (lineNumber === 4) {
          logDate = moment(line.split('on')[1].trim(), 'YYYY-MM-DD HH:mm:ss').format('DD.MM.YYYY');
        }

        // Parse the line time and create a moment object
        let eventTime = moment(`${logDate} ${line.split(' | ')[0]}`, 'DD.MM.YYYY HH:mm:ss');

        // Check if the event falls within the search range
        if (!eventTime.isBetween(searchStart, searchEnd)) continue;

        // Check if the line contains coordinates
        const coordinates = line.match(/<([^>]*)>/);
        if (coordinates) {
          const [eventX, eventY] = coordinates[1].split(', ');

          // Calculate the distance to the specified coordinates
          const distance = Math.hypot(x - eventX, y - eventY);

          // If the event is within the specified radius, add it to the search results
          if (distance <= radius) {
            searchResults.push(`${logDate} | ${line}`);
          }
        }
      }
    }

    // If there were any search results, send them
    if (searchResults.length > 0) {
      // Split the results into chunks of 1900 characters each to account for Discord's 2000 character limit
      let messageChunks = searchResults.join('\n').match(/[\s\S]{1,1900}/g);
      let messagesSent = 0;

      // Iterate over each chunk and send it as a separate message
      for (let chunk of messageChunks) {
        if (messagesSent >= 5) {
          message.channel.send(`There are more logs within the specified radius. Please narrow down the search area.`);
          break;
        }
        message.channel.send(chunk);
        messagesSent++;
      }
    } else {
      message.channel.send(`No results found within the specified radius.`);
    }
  }
});


//////////////////////////////////////////////////////////////////////////////////////////////
// -- /search-dismantled command
//////////////////////////////////////////////////////////////////////////////////////////////
client.on('messageCreate', async (message) => {
  if (message.channel.id !== channelId) return;

  if (message.content.startsWith('/search-dismantle')) {
    const args = message.content.split(' ');

    if (args.length !== 7) {
      return message.channel.send('Incorrect format. Please use "/search-dismantle <date> <time start> <time end> <x> <y> <radius>"');
    }

    const [command, date, timeStart, timeEnd, x, y, radius] = args;
    console.log(`Command received: ${command} Date: ${date} Start: ${timeStart} End: ${timeEnd} X: ${x} Y: ${y} Radius: ${radius}`);

    console.log("Starting search in log files...");
    const searchStart = moment(`${date} ${timeStart}`, 'DD.MM.YYYY HH:mm');
    const searchEnd = moment(`${date} ${timeEnd}`, 'DD.MM.YYYY HH:mm');

    const maxRadius = 1000;
    if (radius > maxRadius) {
      return message.channel.send(`The maximum radius allowed is ${maxRadius}. Please choose a smaller radius.`);
    }

    const files = glob.sync(`${filepath}/**/*${filetype}`);
    let searchResults = [];

    for (const file of files) {
      console.log(`Searching in file: ${file}`);
      const fileStream = fs.createReadStream(file);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let lineNumber = 0;
      let logDate = '';

      for await (const line of rl) {
        lineNumber++;

        if (lineNumber === 4) {
          logDate = moment(line.split('on')[1].trim(), 'YYYY-MM-DD HH:mm:ss').format('DD.MM.YYYY');
        }

        let eventTime = moment(`${logDate} ${line.split(' | ')[0]}`, 'DD.MM.YYYY HH:mm:ss');
        if (!eventTime.isBetween(searchStart, searchEnd)) continue;

        // First check if the line includes "DISMANTLED"
        if (!line.includes('DISMANTLED')) continue;

        const coordinates = line.match(/<([^>]*)>/);
			if (coordinates) {
			  const [eventX, , eventY] = coordinates[1].split(', ').map(parseFloat);
			  const distance = Math.hypot(x - eventX, y - eventY);

			  if (distance <= radius) {
				searchResults.push(`${logDate} | ${line}`);
			  }
			}
      }
    }

    if (searchResults.length > 0) {
      let messageChunks = searchResults.join('\n').match(/[\s\S]{1,1900}/g);
      let messagesSent = 0;

      for (let chunk of messageChunks) {
        if (messagesSent >= 5) {
          message.channel.send(`There are more logs for dismantled events within the specified radius. Please narrow down the search area.`);
          break;
        }
        message.channel.send(chunk);
        messagesSent++;
      }
    } else {
      message.channel.send(`No dismantled events found within the specified radius.`);
    }
  }
});

client.login(token);
