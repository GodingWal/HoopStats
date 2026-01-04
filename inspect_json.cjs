const fs = require('fs');
try {
    const data = JSON.parse(fs.readFileSync('temp_gamelog.json', 'utf8'));
    console.log('Root keys:', Object.keys(data));
    if (data.events) console.log('Number of events:', Object.keys(data.events).length);
    // Check for other potential containers
    ['seasonTypes', 'entries', 'log', 'stats', 'categories'].forEach(key => {
        if (data[key]) console.log(`${key} found, type: ${typeof data[key]}`);
    });

    // Look for the stats values
    // Usually in 'seasonTypes' -> 'categories' -> 'events' -> 'stats'
    // Or in 'events' if it's different.

    // Let's print the structure of one seasonType if it exists
    if (data.seasonTypes) {
        console.log('SeasonTypes:', JSON.stringify(data.seasonTypes, null, 2).substring(0, 500));
    }
} catch (e) {
    console.error(e);
}
