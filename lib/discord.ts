import { Client, GatewayIntentBits, TextChannel } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

let ready = false;
client.once('ready', () => {
    ready = true;
    console.log('Discord bot ready!');
});

client.login(process.env.DISCORD_BOT_TOKEN);

export async function sendDiscordMessage(channelId: string, message: string) {
    if (!ready) return;
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
        (channel as TextChannel).send(message);
    }
}