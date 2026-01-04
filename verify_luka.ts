
import { fetchAllTeams, fetchTeamRoster } from "./server/espn-api";

async function verifyLuka() {
    console.log("Fetching teams...");
    const teams = await fetchAllTeams();
    console.log(`Found ${teams.length} teams.`);

    for (const team of teams) {
        if (team.abbreviation === 'LAL' || team.abbreviation === 'DAL') {
            console.log(`Checking ${team.displayName} (${team.abbreviation})...`);
            const roster = await fetchTeamRoster(team.id);
            const luka = roster.find(p => p.displayName.includes("Don")); // Searching broadly
            if (luka) {
                console.log(`FOUND LUKA in ${team.abbreviation}:`, luka.displayName, luka.id);
            }
        }
    }
}

verifyLuka().catch(console.error);
