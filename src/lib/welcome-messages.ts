/**
 * Welcome messages — a collection of time-of-day-aware and quirky greetings
 * shown in the empty-state hero area above the input bar.
 *
 * Each message has text and an optional emoji prefix. The `getWelcomeMessage`
 * function picks a message based on the user's local hour, so the greeting
 * always feels fresh and contextually appropriate.
 */

export interface WelcomeMessage {
  /** The main text shown below the goatLLM heading. */
  text: string;
  /** Optional emoji prefix (e.g. "🌅", "☕"). Rendered inline. */
  emoji?: string;
  /** Optional larger/display variant for random spotlight (some messages get
   *  shown in a bigger font on occasion). */
  display?: boolean;
}

// ─── Dawn (5–7 AM) — early birds, late owls crossing over ───

const dawn: WelcomeMessage[] = [
  { text: "You're up early. Goat's ready.", emoji: "🌅" },
  { text: "Crack of dawn, crack of code.", emoji: "🐐" },
  { text: "First light, first commit.", emoji: "☀️" },
  { text: "The early goat gets the LLM token.", emoji: "⏰" },
  { text: "Who needs coffee when you have tokens?", emoji: "⚡" },
  { text: "Sunrise session. Let's build something.", emoji: "🌄" },
  { text: "The world is quiet. The goat is not.", emoji: "🌙" },
  { text: "Dawn patrol. Type below.", emoji: "🕊️" },
  { text: "Birds are chirping. So is your CPU.", emoji: "🐦" },
  { text: "Zero notifications. Infinite context.", emoji: "🧘" },
];

// ─── Morning (7–11 AM) — fresh, productive, slightly caffeinated ───

const morning: WelcomeMessage[] = [
  { text: "Good morning. Let's make things.", emoji: "☀️" },
  { text: "Fresh cup, fresh chat.", emoji: "☕" },
  { text: "Morning headspace. What's the plan?", emoji: "🧠" },
  { text: "The goat is caffeinated and ready.", emoji: "🐐" },
  { text: "Breakfast of champions: tokens and ambition.", emoji: "🥐" },
  { text: "Another day, another prompt.", emoji: "📝" },
  { text: "Type your morning thoughts below.", emoji: "💭" },
  { text: "Sun's up. Ship it.", emoji: "🚀" },
  { text: "Let's make today's first mistake together.", emoji: "🤝" },
  { text: "Morning ritual: stare at goat, type words.", emoji: "🫡" },
  { text: "The early bird gets the GPT-4o response.", emoji: "🐦" },
  { text: "Rise and prompt.", emoji: "🌅" },
  { text: "Go get 'em, tiger. And by 'em, I mean tokens.", emoji: "🐯" },
  { text: "Your goat is ready when you are.", emoji: "✅" },
  { text: "Startup warmup sequence complete.", emoji: "🔄" },
];

// ─── Late Morning / Pre-Noon (11 AM – 12 PM) ───

const preNoon: WelcomeMessage[] = [
  { text: "Almost lunch. Almost shipped.", emoji: "⏳" },
  { text: "Pre-noon crunch. Let's go.", emoji: "🔥" },
  { text: "Still morning if you haven't eaten yet.", emoji: "🤷" },
  { text: "Second coffee, third prompt.", emoji: "☕" },
  { text: "Noon approaches. The goat does not nap.", emoji: "🐐" },
  { text: "Eleventh hour energy.", emoji: "⚡" },
  { text: "Just shipped something? No? There's still time.", emoji: "🕚" },
  { text: "Pre-lunch deep work window. Use it.", emoji: "🎯" },
  { text: "Morning momentum. Don't break the chain.", emoji: "⛓️" },
  { text: "The goat is in flow. Join it.", emoji: "🌊" },
];

// ─── Afternoon (12–5 PM) — workhorse hours ───

const afternoon: WelcomeMessage[] = [
  { text: "Afternoon grind. Let's ship.", emoji: "⚙️" },
  { text: "Post-lunch clarity. Time to build.", emoji: "🍱" },
  { text: "The goat doesn't siesta. Well, maybe a little.", emoji: "😴" },
  { text: "Afternoon session. Caffeine level: optimal.", emoji: "☕" },
  { text: "Let's make this afternoon count.", emoji: "🎯" },
  { text: "Second wind. Feel that?", emoji: "💨" },
  { text: "Afternoon code hits different.", emoji: "⚡" },
  { text: "The goat is in the zone. Disturb, if you dare.", emoji: "🐐" },
  { text: "Three o'clock energy. Let's roll.", emoji: "🕐" },
  { text: "Mid-afternoon. Prime prompting hours.", emoji: "📊" },
  { text: "Keep going. The goat believes in you.", emoji: "💪" },
  { text: "You've got 2-3 good hours left. Use them.", emoji: "⏰" },
  { text: "Afternoon deep work > morning panic.", emoji: "🧘" },
  { text: "Type your way through the afternoon slump.", emoji: "⌨️" },
  { text: "The goat is persistent. You should be too.", emoji: "🦾" },
  { text: "One more feature before standup.", emoji: "🏗️" },
  { text: "Afternoon delight: unlimited tokens.", emoji: "🍪" },
  { text: "Crunch time, but make it relaxed.", emoji: "😎" },
];

// ─── Evening (5–8 PM) — winding down or pushing through ───

const evening: WelcomeMessage[] = [
  { text: "Evening code. Dim the lights, open the IDE.", emoji: "🌆" },
  { text: "Golden hour for golden prompts.", emoji: "🌇" },
  { text: "The goat moonlights as well.", emoji: "🐐" },
  { text: "Sunset session. One more feature.", emoji: "☀️" },
  { text: "Evening vibes. Still building.", emoji: "🎑" },
  { text: "Day's almost done. Ship that last thing.", emoji: "📦" },
  { text: "Evening grind. The goat doesn't clock out.", emoji: "🕐" },
  { text: "One more prompt before dinner.", emoji: "🍝" },
  { text: "Twilight code. Magic happens here.", emoji: "✨" },
  { text: "Evening calm, focused mind.", emoji: "🧠" },
  { text: "Wind down or double down. Your call.", emoji: "🤷" },
  { text: "After-hours access granted.", emoji: "🛠️" },
  { text: "The debugger doesn't rest. Neither does the goat.", emoji: "🐛" },
  { text: "Prime time for the unhinged prompts.", emoji: "🎭" },
  { text: "Evening mode: unlocked.", emoji: "🔓" },
  { text: "Work-life balance? Never heard of her.", emoji: "⚖️" },
];

// ─── Night (8 PM – 12 AM) — late night coding energy ───

const night: WelcomeMessage[] = [
  { text: "Night owl mode. The goat sees in the dark.", emoji: "🦉" },
  { text: "Late night, sharp mind, zero distractions.", emoji: "🌙" },
  { text: "The stars are out. So is the context window.", emoji: "⭐" },
  { text: "Night coding > day coding. Change my mind.", emoji: "🌃" },
  { text: "Midnight oil. Premium grade.", emoji: "🕯️" },
  { text: "The goat doesn't sleep. Do you?", emoji: "😈" },
  { text: "Silence. Darkness. Infinite tokens.", emoji: "🖤" },
  { text: "Late night prompt energy. Unfiltered.", emoji: "🔥" },
  { text: "No meetings. No notifications. Just the goat.", emoji: "📵" },
  { text: "Night mode activates: goblin hours.", emoji: "🧌" },
  { text: "The LLM is awake. Are you?", emoji: "👁️" },
  { text: "After midnight code. Dangerous. Fun.", emoji: "⚡" },
  { text: "Third wind. Let's see where this goes.", emoji: "🌪️" },
  { text: "Tangents welcome. The goat has no deadlines.", emoji: "🌀" },
  { text: "2 AM energy: the best ideas and the worst typos.", emoji: "🤪" },
  { text: "Night owl server. Tokens served 24/7.", emoji: "🦉" },
];

// ─── Witching Hour (12 AM – 5 AM) — deep, unhinged, dangerous ───

const witching: WelcomeMessage[] = [
  { text: "It's past midnight. Are you building or breaking?", emoji: "🔮" },
  { text: "Witching hour. The goat is at full power.", emoji: "🧙" },
  { text: "Sleep is for people without ideas.", emoji: "💡" },
  { text: "Deep night. Deep context. Deep code.", emoji: "🕳️" },
  { text: "The witching hour. Tokens flow freely.", emoji: "🌕" },
  { text: "You should be asleep. So should your bugs.", emoji: "🐛" },
  { text: "3 AM thoughts deserve 128K context.", emoji: "🤯" },
  { text: "The goat never sleeps. But you probably should.", emoji: "😵" },
  { text: "Late night existentialism meets LLM.", emoji: "♾️" },
  { text: "Dark mode IRL. The goat adapts.", emoji: "🌑" },
  { text: "No one is watching. Type anything.", emoji: "🫣" },
  { text: "The best code is written when no one's looking.", emoji: "🤫" },
  { text: "Insomnia has never been this productive.", emoji: "📈" },
  { text: "4 AM creativity hits different.", emoji: "🎨" },
  { text: "The goat is here for your 3 AM refactor idea.", emoji: "🔄" },
];

// ─── Weekday-specific ───

const weekday: Record<number, WelcomeMessage[]> = {
  // Monday
  1: [
    { text: "Monday. The goat has no case of the Mondays.", emoji: "🐐" },
    { text: "New week, new prompts. Let's go.", emoji: "📅" },
    { text: "Monday momentum. Start strong.", emoji: "💪" },
    { text: "Monday mode: caffeinate, prompt, repeat.", emoji: "☕" },
  ],
  // Tuesday
  2: [
    { text: "Tuesday. The real Monday.", emoji: "📆" },
    { text: "Tuesday grind. You've got this.", emoji: "🔥" },
    { text: "Second day energy. No more Monday excuses.", emoji: "⚡" },
    { text: "Tuesday: Monday's less angry cousin.", emoji: "😌" },
  ],
  // Wednesday
  3: [
    { text: "Hump day. The goat is halfway there.", emoji: "🐫" },
    { text: "Wednesday. You can see the weekend from here.", emoji: "👀" },
    { text: "Midweek check. How's the code looking?", emoji: "✅" },
    { text: "Wednesday wisdom: prompt early, ship often.", emoji: "📜" },
    { text: "Hump day. Keep climbing.", emoji: "⛰️" },
  ],
  // Thursday
  4: [
    { text: "Thursday. Almost there. Ship something.", emoji: "📦" },
    { text: "Pre-Friday energy. Dangerous levels of productivity.", emoji: "🧨" },
    { text: "Thursday. The Friday preview.", emoji: "👀" },
    { text: "One more day of disciplined prompting.", emoji: "📋" },
  ],
  // Friday
  5: [
    { text: "Friday. Ship it and go home.", emoji: "🚀" },
    { text: "Friday vibes. Prompt fast, break nothing.", emoji: "🎉" },
    { text: "Weekend preview mode. The goat earned it.", emoji: "🐐" },
    { text: "Friday afternoon code. Handle with care.", emoji: "⚠️" },
    { text: "TGIF. The Goat Is Free.", emoji: "🦅" },
    { text: "Friday: last chance to ship before Monday you regrets it.", emoji: "🎯" },
  ],
  // Saturday
  6: [
    { text: "Saturday code. No deadlines, pure joy.", emoji: "😌" },
    { text: "Weekend mode. Build for fun.", emoji: "🎨" },
    { text: "Saturday. No standup. Just goat.", emoji: "🐐" },
    { text: "Weekend warrior. The goat respects the hustle.", emoji: "⚔️" },
    { text: "Zero meetings. Infinite context. Perfect.", emoji: "🧘" },
  ],
  // Sunday
  0: [
    { text: "Sunday. The calm before the commit.", emoji: "😇" },
    { text: "Sunday session. Refactor with a clear mind.", emoji: "🧹" },
    { text: "Sunday code hits different. No pressure.", emoji: "🎵" },
    { text: "Lazy Sunday prompts. No judgment.", emoji: "🛋️" },
    { text: "Sunday: the best day to break and fix things.", emoji: "🔧" },
  ],
};

// ─── Anytime — general, quirky, funny ───

const anytime: WelcomeMessage[] = [
  { text: "Goat is ready. Are you?", emoji: "🐐" },
  { text: "Type below. The goat is listening.", emoji: "👂" },
  { text: "Your wish is the goat's command.", emoji: "🧞" },
  { text: "Start typing. Magic happens.", emoji: "✨" },
  { text: "Prompt me, maybe?", emoji: "🎤" },
  { text: "The goat has entered the chat.", emoji: "🐐" },
  { text: "Hello, builder. What's it gonna be?", emoji: "👷" },
  { text: "Your AI coworker is clocked in.", emoji: "⏰" },
  { text: "GoatLLM: like a rubber duck, but it talks back.", emoji: "🦆" },
  { text: "Welcome back. Your tokens missed you.", emoji: "🫶" },
  { text: "So, what are we building today?", emoji: "🏗️" },
  { text: "The goat is patient. Type when ready.", emoji: "🧘" },
  { text: "Fire away. I'll clean up the mess.", emoji: "🔥" },
  { text: "This is your brain on goatLLM.", emoji: "🧠" },
  { text: "New chat, who dis?", emoji: "📱" },
  { text: "Ready when you are, boss.", emoji: "👔" },
  { text: "Let's cook.", emoji: "👨‍🍳" },
  { text: "The goat is a vibe. Are you?", emoji: "🎵" },
  { text: "Prompt responsibly. Or don't. I'm not your manager.", emoji: "😏" },
  { text: "Unlimited tokens, zero judgment.", emoji: "🃏" },
  { text: "What's on your mind?", emoji: "💭" },
  { text: "The goat is lean, mean, and prompting.", emoji: "💪" },
  { text: "Type your heart out.", emoji: "❤️" },
  { text: "Go ahead. Make me generate something.", emoji: "🎰" },
  { text: "I'm literally built for this. Go on.", emoji: "🤖" },
  { text: "Chats are cheap. Type something interesting.", emoji: "💰" },
  { text: "The goat has unlimited context. Do you?", emoji: "📚" },
  { text: "Beep boop. Ready to prompt.", emoji: "🛸" },
  { text: "What if we just — yeah, type it.", emoji: "🤔" },
  { text: "The goat sees your cursor blinking. Impress it.", emoji: "👀" },
  { text: "Go ahead. Type the thing.", emoji: "🎯" },
  { text: "You type, I respond. The circle of life.", emoji: "🌍" },
  { text: "This is fine. Everything is fine. Type away.", emoji: "🐶" },
  { text: "The goat is powered by electricity and vibes.", emoji: "⚡" },
  { text: "Your prompt is my command. Literally.", emoji: "💻" },
  { text: "I'm here to help you look smart.", emoji: "🎓" },
  { text: "No prompt too small. No ask too weird.", emoji: "🛡️" },
  { text: "Let's make something people actually use.", emoji: "🌐" },
  { text: "The goat has entered the building.", emoji: "🚪" },
  { text: "Type. It's free.", emoji: "🆓" },
  { text: "Goat at your service. 24/7. No breaks.", emoji: "🛎️" },
  { text: "Just you, the goat, and 128K of context.", emoji: "🌌" },
  { text: "Ready, set, prompt!", emoji: "🏁" },
  { text: "Let's make some magic happen.", emoji: "🎩" },
  { text: "The goat is listening. Tell it everything.", emoji: "👂" },
  { text: "This is your captain speaking. Prompt when ready.", emoji: "🧑‍✈️" },
  { text: "Type below to unlock infinite possibilities.", emoji: "🔑" },
  { text: "Don't overthink it. Just type.", emoji: "😤" },
  { text: "Go ahead. Ask the goat anything.", emoji: "🙋" },
  { text: "The goat's hot and ready.", emoji: "🌮" },
  { text: "Prompting is the new Googling.", emoji: "🔍" },
  { text: "The goat is serverless, fearless, and peerless.", emoji: "🏆" },
  { text: "New conversation. Infinite potential.", emoji: "🌱" },
  { text: "Let's build something that breaks prod.", emoji: "💥" },
  { text: "Your personal AI goat. No subscription needed.", emoji: "🎁" },
  { text: "The goat doesn't bite. Unless you ask nicely.", emoji: "😈" },
  { text: "Goat mode: activated.", emoji: "🟢" },
  { text: "This is the way.", emoji: "🤖" },
  { text: "I don't always prompt, but when I do, I use goatLLM.", emoji: "🍺" },
  { text: "The goat is ready. The question is: are you prompt?", emoji: "⌨️" },
  { text: "Hello, world.", emoji: "👋" },
];

// ─── "Display" messages — slightly longer, more whimsical, shown occasionally
//      in a larger font as a fun surprise. ───

const displayMessages: WelcomeMessage[] = [
  { text: "Let's build something ridiculous.", emoji: "🎪", display: true },
  { text: "The goat is ready. No, wait — the goat was born ready.", emoji: "🐐", display: true },
  { text: "Welcome to goatLLM. Prepare to be prompted.", emoji: "⚡", display: true },
  { text: "So many tokens, so little time.", emoji: "⏳", display: true },
  { text: "You bring the ideas. I'll bring the compute.", emoji: "🧠", display: true },
  { text: "Another day, another 100K tokens.", emoji: "🥇", display: true },
  { text: "GoatLLM: because thinking alone is overrated.", emoji: "🧐", display: true },
  { text: "Do NOT go gentle into that good prompt.", emoji: "🌄", display: true },
  { text: "I'm not a regular LLM, I'm a cool LLM.", emoji: "😎", display: true },
  { text: "Type something. Anything. The goat has no judgment.", emoji: "🤷", display: true },
  { text: "Who needs a rubber duck when you have a goat?", emoji: "🦆", display: true },
  { text: "The goat is here. The goat is ready. The goat is prompt.", emoji: "🐐", display: true },
  { text: "You had me at 'hello world'.", emoji: "💻", display: true },
  { text: "Let's write some code that future us will thank us for.", emoji: "⏳", display: true },
  { text: "goatLLM — because 'goatGPT' was already taken.", emoji: "🤦", display: true },
  { text: "This is your brain. This is your brain on goatLLM.", emoji: "🍳", display: true },
  { text: "All your base are belong to goat.", emoji: "👾", display: true },
  { text: "The goat is feature-complete. You're not. Ship it.", emoji: "📦", display: true },
  { text: "Warning: may cause sudden bursts of productivity.", emoji: "⚠️", display: true },
  { text: "The goat is not just a mascot. The goat is a lifestyle.", emoji: "🐐", display: true },
  { text: "The prompt is strong with this one.", emoji: "🪐", display: true },
];

// ─── Pick a random element from an array ───

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Public API ───

export interface WelcomeMessageResult {
  /** The selected WelcomeMessage. */
  message: WelcomeMessage;
  /** The time-of-day bucket that was selected. */
  period: string;
}

/**
 * Returns a welcome message appropriate for the user's current local time.
 *
 * Selection strategy:
 *   1. If the current hour matches a time-of-day bucket, pick from that bucket.
 *   2. With 15% chance, also consider weekday-specific messages (Mon–Sun).
 *   3. With 5% chance, pick a "display" message (larger font variant).
 *   4. Otherwise fall back to the "anytime" general pool.
 *
 * The result includes the message and the period label for debugging or
 * display purposes.
 */
export function getWelcomeMessage(): WelcomeMessageResult {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat

  // Determine the time-of-day bucket
  let period: string;
  let pool: WelcomeMessage[];

  if (hour >= 5 && hour < 7) { period = "dawn"; pool = dawn; }
  else if (hour >= 7 && hour < 11) { period = "morning"; pool = morning; }
  else if (hour >= 11 && hour < 12) { period = "preNoon"; pool = preNoon; }
  else if (hour >= 12 && hour < 17) { period = "afternoon"; pool = afternoon; }
  else if (hour >= 17 && hour < 20) { period = "evening"; pool = evening; }
  else if (hour >= 20) { period = "night"; pool = night; }
  else { period = "witching"; pool = witching; }

  // 12% chance: pick a display message (larger font)
  if (Math.random() < 0.12) {
    return { message: pick(displayMessages), period: "display" };
  }

  // 15% chance: try weekday-specific
  if (Math.random() < 0.15) {
    const dayPool = weekday[dayOfWeek];
    if (dayPool && dayPool.length > 0) {
      return { message: pick(dayPool), period: `weekday-${dayOfWeek}` };
    }
  }

  // 50/50: pick from time-of-day pool vs. anytime pool
  if (Math.random() < 0.5) {
    return { message: pick(pool), period };
  }

  return { message: pick(anytime), period: "anytime" };
}

/**
 * Returns the total count of unique messages across all pools (for stats).
 */
export function getMessageCount(): number {
  const pools = [
    dawn, morning, preNoon, afternoon, evening, night, witching,
    ...Object.values(weekday).flat(),
    anytime, displayMessages,
  ];
  return pools.flat().length;
}
