const fs = require('fs');
try {
    const data = JSON.parse(fs.readFileSync('temp_teams.json', 'utf8'));
    const teams = data.sports?.[0]?.leagues?.[0]?.teams;
    if (teams) {
        console.log('Found', teams.length, 'teams');
        console.log('First team:', JSON.stringify(teams[0], null, 2));
    } else {
        console.log('Structure unexpected:', Object.keys(data));
    }
} catch (e) { console.error(e); }
