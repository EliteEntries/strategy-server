import { Client, GatewayIntentBits, TextChannel, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ModalSubmitInteraction, ThreadChannel } from 'discord.js';
import { getTodaysTrades, getYesterdaysTrades, formatTradesForDiscord } from './tradeLogger';
import { scheduleJob } from 'node-schedule';
import { promises as fs } from 'fs';
import { join } from 'path';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// Symbol configuration - can be updated from index.ts
let symbols2: string[] = [];
let symbols5: string[] = [];
let symbolsSell: string[] = [];
let threshold2 = 2;
let threshold5 = 5;
let thresholdSell = 2;

export function setSymbolConfig(config: { symbols2: string[], symbols5: string[], symbolsSell?: string[], threshold2: number, threshold5: number, thresholdSell?: number }) {
    symbols2 = config.symbols2;
    symbols5 = config.symbols5;
    symbolsSell = config.symbolsSell || [];
    threshold2 = config.threshold2;
    threshold5 = config.threshold5;
    thresholdSell = config.thresholdSell ?? 2;
}

// Register slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('info')
        .setDescription('Get current dip buyer configuration'),
    new SlashCommandBuilder()
        .setName('day')
        .setDescription('Show trades placed today'),
    new SlashCommandBuilder()
        .setName('yesterday')
        .setDescription('Show trades placed yesterday'),
    new SlashCommandBuilder()
        .setName('test-standup')
        .setDescription('Test the daily standup message (sends to test channel)'),
].map(command => command.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);
    try {
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APP_ID!),
            { body: commands }
        );
        console.log('Discord slash commands registered!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
}

let ready = false;
client.once('ready', async () => {
    ready = true;
    console.log('Discord bot ready!');
    await registerCommands();
    scheduleDailyStandup();
});

// Schedule daily standup message at 12:00 AM EST
function scheduleDailyStandup() {
    // Cron: 0 0 * * * = midnight, timezone set to America/New_York (EST/EDT)
    scheduleJob({ hour: 0, minute: 0, tz: 'America/New_York' }, async () => {
        const dailyChannelId = process.env.DISCORD_DAILY_ID;
        if (!dailyChannelId) {
            console.error('DISCORD_DAILY_ID not configured');
            return;
        }

        const today = new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            timeZone: 'America/New_York'
        });

        const message = buildStandupMessage(today);

        await sendDailyStandupMessage(dailyChannelId, message);
        console.log(`Daily standup message sent for ${today}`);
    });
    
    console.log('Daily standup scheduled for 12:00 AM EST');
}

function buildStandupMessage(today: string): string {
    return [
        `📅 **Today is ${today}**`,
        '',
        'Good morning team! Time for your daily check-in.',
        '',
        '📋 Tasks  •  🔄 Updates  •  🚧 Blockers  •  💡 Insights  •  ❓ Questions',
        '\u200b',
    ].join('\n');
}

function buildStandupButton(threadId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`daily_standup_btn:${threadId}`)
                .setLabel('📝 Submit Check-in')
                .setStyle(ButtonStyle.Primary)
        );
}

// Handle slash command interactions
client.on('interactionCreate', async (interaction) => {
    // Handle button clicks
    if (interaction.isButton() && interaction.customId.startsWith('daily_standup_btn:')) {
        const threadId = interaction.customId.split(':')[1];
        
        const modal = new ModalBuilder()
            .setCustomId(`daily_standup_modal:${threadId}`)
            .setTitle('Daily Check-in');

        const tasksInput = new TextInputBuilder()
            .setCustomId('tasks')
            .setLabel('📋 Tasks - What are you working on today?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('List your tasks for today...')
            .setRequired(false)
            .setMaxLength(1000);

        const updatesInput = new TextInputBuilder()
            .setCustomId('updates')
            .setLabel('🔄 Updates - Any progress or news?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Share any updates or progress...')
            .setRequired(false)
            .setMaxLength(1000);

        const blockersInput = new TextInputBuilder()
            .setCustomId('blockers')
            .setLabel('🚧 Blockers - Anything blocking you?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('List any blockers or challenges...')
            .setRequired(false)
            .setMaxLength(1000);

        const insightsInput = new TextInputBuilder()
            .setCustomId('insights')
            .setLabel('💡 Insights & ❓ Questions')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Any learnings, discoveries, or questions for the team?')
            .setRequired(false)
            .setMaxLength(1000);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(tasksInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(updatesInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(blockersInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(insightsInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // Handle modal submissions
    if (interaction.isModalSubmit() && interaction.customId.startsWith('daily_standup_modal:')) {
        const threadId = interaction.customId.split(':')[1];
        
        const tasks = interaction.fields.getTextInputValue('tasks').trim();
        const updates = interaction.fields.getTextInputValue('updates').trim();
        const blockers = interaction.fields.getTextInputValue('blockers').trim();
        const insights = interaction.fields.getTextInputValue('insights').trim();

        const sections: string[] = [
            `**${interaction.user.displayName}'s Check-in** 📋`,
            ''
        ];

        if (tasks) sections.push(`**Tasks:**\n${tasks}`, '');
        if (updates) sections.push(`**Updates:**\n${updates}`, '');
        if (blockers) sections.push(`**Blockers:**\n${blockers}`, '');
        if (insights) sections.push(`**Insights/Questions:**\n${insights}`, '');

        if (sections.length === 2) {
            await interaction.reply({ content: 'Please fill in at least one field!', ephemeral: true });
            return;
        }

        try {
            const thread = await client.channels.fetch(threadId) as ThreadChannel;
            await thread.send(sections.join('\n'));
            await interaction.reply({ content: '✅ Check-in submitted!', ephemeral: true });
            
            // Get the date from the thread for JSON logging
            const today = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                timeZone: 'America/New_York'
            }).replace(/\//g, '-');
            
            // Save to JSON
            await saveStandupResponse({
                date: today,
                threadId,
                timestamp: new Date().toISOString(),
                userId: interaction.user.id,
                username: interaction.user.username,
                displayName: interaction.user.displayName,
                tasks,
                updates,
                blockers,
                insights
            });
        } catch (error) {
            console.error('Error posting to thread:', error);
            await interaction.reply({ content: '❌ Failed to post to thread', ephemeral: true });
        }
        
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'info') {
        const message = [
            '**Dip Buyer Configuration**',
            '',
            `**${threshold2}% Buyer Symbols:**`,
            symbols2.length > 0 ? symbols2.join(', ') : 'None configured',
            '',
            `**${threshold5}% Buyer Symbols:**`,
            symbols5.length > 0 ? symbols5.join(', ') : 'None configured',
        ].join('\n');

        await interaction.reply(message);
    }

    if (interaction.commandName === 'day') {
        const trades = getTodaysTrades();
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const message = formatTradesForDiscord(trades, `Trades for Today (${today})`);
        await interaction.reply(message);
    }

    if (interaction.commandName === 'yesterday') {
        const trades = getYesterdaysTrades();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const message = formatTradesForDiscord(trades, `Trades for Yesterday (${dateStr})`);
        await interaction.reply(message);
    }

    if (interaction.commandName === 'test-standup') {
        const testChannelId = process.env.DISCORD_TEST_ID;
        if (!testChannelId) {
            await interaction.reply({ content: 'DISCORD_TEST_ID not configured in .env', ephemeral: true });
            return;
        }

        const today = new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            timeZone: 'America/New_York'
        });

        const message = buildStandupMessage(today);

        await sendDailyStandupMessage(testChannelId, message);
        await interaction.reply({ content: '✅ Test standup message sent to test channel!', ephemeral: true });
    }
});

// Prevent double login
if (!client.isReady()) {
    client.login(process.env.DISCORD_BOT_TOKEN);
}

export async function sendDiscordMessage(channelId: string, message: string) {
    if (!ready) return;
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
        (channel as TextChannel).send(message);
    }
}

async function sendDailyStandupMessage(channelId: string, message: string) {
    if (!ready) return;
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
        const prettyDate = new Date().toLocaleDateString('en-US', { 
            weekday: 'short',
            month: 'short', 
            day: 'numeric',
            timeZone: 'America/New_York'
        });
        
        // Send message without button first
        const sentMessage = await (channel as TextChannel).send({ content: message });
        
        // Create thread
        const thread = await sentMessage.startThread({
            name: `${prettyDate} Check-ins`,
            autoArchiveDuration: 1440 // 24 hours
        });
        
        // Now edit message to add button with thread ID embedded
        const button = buildStandupButton(thread.id);
        await sentMessage.edit({ content: message, components: [button] });
        
        console.log(`Created thread ${thread.id} for ${prettyDate}`);
    }
}

async function saveStandupResponse(data: any) {
    const logsDir = join(process.cwd(), 'logs', 'standups');
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const fileName = `${year}-${month}.json`;
    const filePath = join(logsDir, fileName);
    
    try {
        await fs.mkdir(logsDir, { recursive: true });
        
        let responses = [];
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            responses = JSON.parse(content);
        } catch {
            // File doesn't exist yet
        }
        
        responses.push(data);
        await fs.writeFile(filePath, JSON.stringify(responses, null, 2));
        console.log(`Saved standup response to ${filePath}`);
    } catch (error) {
        console.error('Error saving standup response:', error);
    }
}