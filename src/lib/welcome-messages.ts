/**
 * Welcome messages — time-of-day-aware greetings shown in the empty-state
 * hero area above the input bar.
 */

export interface WelcomeMessage {
  text: string;
  emoji?: string;
  display?: boolean;
}

// ─── Dawn (5–7 AM) ───

const dawn: WelcomeMessage[] = [
  { text: "You're up early. The servers never slept." },
  { text: "Crack of dawn, crack of code." },
  { text: "First light, first commit." },
  { text: "Who needs coffee when you have curiosity?" },
  { text: "Sunrise session. Let's build something." },
  { text: "The world is quiet. Perfect time to ship." },
  { text: "Dawn patrol. Type below." },
  { text: "Zero notifications. Infinite focus." },
];

// ─── Morning (7–11 AM) ───

const morning: WelcomeMessage[] = [
  { text: "Good morning. Let's make things." },
  { text: "Fresh cup, fresh chat." },
  { text: "Morning headspace. What's the plan?" },
  { text: "Breakfast of champions: caffeine and ambition." },
  { text: "Another day, another prompt." },
  { text: "Type your morning thoughts below." },
  { text: "Sun's up. Ship it." },
  { text: "Let's make today's first mistake together." },
  { text: "The early bird gets the cached response." },
  { text: "Rise and prompt." },
];

// ─── Late Morning / Pre-Noon (11 AM – 12 PM) ───

const preNoon: WelcomeMessage[] = [
  { text: "Almost lunch. Almost shipped." },
  { text: "Pre-noon crunch. Let's go." },
  { text: "Still morning if you haven't eaten yet." },
  { text: "Second coffee, third prompt." },
  { text: "Eleventh hour energy." },
  { text: "Just shipped something? No? There's still time." },
  { text: "Pre-lunch deep work window. Use it." },
  { text: "Morning momentum. Don't break the chain." },
];

// ─── Afternoon (12–5 PM) ───

const afternoon: WelcomeMessage[] = [
  { text: "Afternoon grind. Let's ship." },
  { text: "Post-lunch clarity. Time to build." },
  { text: "Afternoon session. Caffeine level: optimal." },
  { text: "Let's make this afternoon count." },
  { text: "Second wind. Feel that?" },
  { text: "Afternoon code hits different." },
  { text: "Three o'clock energy. Let's roll." },
  { text: "Keep going. You've got this." },
  { text: "You've got 2-3 good hours left. Use them." },
  { text: "Afternoon deep work beats morning panic." },
  { text: "Type your way through the afternoon slump." },
  { text: "One more feature before standup." },
  { text: "Crunch time, but make it relaxed." },
];

// ─── Evening (5–8 PM) ───

const evening: WelcomeMessage[] = [
  { text: "Evening code. Dim the lights, open the IDE." },
  { text: "Golden hour for golden ideas." },
  { text: "Sunset session. One more feature." },
  { text: "Evening vibes. Still building." },
  { text: "Day's almost done. Ship that last thing." },
  { text: "One more prompt before dinner." },
  { text: "Twilight code. Magic happens here." },
  { text: "Evening calm, focused mind." },
  { text: "Wind down or double down. Your call." },
  { text: "Prime time for the unhinged prompts." },
];

// ─── Night (8 PM – 12 AM) ───

const night: WelcomeMessage[] = [
  { text: "Night owl mode. Silence is golden." },
  { text: "Late night, sharp mind, zero distractions." },
  { text: "The stars are out. So is the cursor." },
  { text: "Night coding beats day coding. Fight me." },
  { text: "Midnight oil. Premium grade." },
  { text: "Silence. Darkness. Infinite possibilities." },
  { text: "Late night prompt energy. Unfiltered." },
  { text: "No meetings. No notifications. Just you." },
  { text: "After midnight code. Dangerous. Fun." },
  { text: "Third wind. Let's see where this goes." },
  { text: "Tangents welcome. No deadlines here." },
  { text: "2 AM energy: the best ideas and the worst typos." },
];

// ─── Witching Hour (12 AM – 5 AM) ───

const witching: WelcomeMessage[] = [
  { text: "It's past midnight. Building or breaking?" },
  { text: "Sleep is for people without ideas." },
  { text: "Deep night. Deep focus. Deep code." },
  { text: "You should be asleep. So should your bugs." },
  { text: "3 AM thoughts deserve unlimited context." },
  { text: "Late night existentialism meets the terminal." },
  { text: "Dark mode IRL." },
  { text: "No one is watching. Type anything." },
  { text: "The best code is written when no one's looking." },
  { text: "Insomnia has never been this productive." },
  { text: "4 AM creativity hits different." },
  { text: "Here for your 3 AM refactor idea." },
];

// ─── Weekday-specific ───

const weekday: Record<number, WelcomeMessage[]> = {
  // Monday
  1: [
    { text: "Monday. New week, new prompts." },
    { text: "Monday momentum. Start strong." },
    { text: "Monday mode: caffeinate, prompt, repeat." },
    { text: "Fresh week. Fresh context window." },
  ],
  // Tuesday
  2: [
    { text: "Tuesday. The real Monday." },
    { text: "Tuesday grind. You've got this." },
    { text: "Second day energy. No more Monday excuses." },
    { text: "Tuesday: Monday's less angry cousin." },
  ],
  // Wednesday
  3: [
    { text: "Hump day. Halfway there." },
    { text: "Wednesday. You can see the weekend from here." },
    { text: "Midweek check. How's the code looking?" },
    { text: "Wednesday wisdom: prompt early, ship often." },
    { text: "Hump day. Keep climbing." },
  ],
  // Thursday
  4: [
    { text: "Thursday. Almost there. Ship something." },
    { text: "Pre-Friday energy. Dangerous levels of productivity." },
    { text: "Thursday. The Friday preview." },
    { text: "One more day. You've got this." },
  ],
  // Friday
  5: [
    { text: "Friday. Ship it and go home." },
    { text: "Friday vibes. Prompt fast, break nothing." },
    { text: "Weekend preview mode." },
    { text: "Friday afternoon code. Handle with care." },
    { text: "Friday: last chance to ship before Monday you regrets it." },
  ],
  // Saturday
  6: [
    { text: "Saturday code. No deadlines, pure joy." },
    { text: "Weekend mode. Build for fun." },
    { text: "Saturday. No standup. Just code." },
    { text: "Weekend warrior. Respect the hustle." },
    { text: "Zero meetings. Infinite context. Perfect." },
  ],
  // Sunday
  0: [
    { text: "Sunday. The calm before the commit." },
    { text: "Sunday session. Refactor with a clear mind." },
    { text: "Sunday code hits different. No pressure." },
    { text: "Lazy Sunday prompts. No judgment." },
    { text: "Sunday: the best day to break and fix things." },
  ],
};

// ─── Anytime — general, quirky, funny ───

const anytime: WelcomeMessage[] = [
  { text: "Type below. Magic happens." },
  { text: "Start typing. Let's see where this goes." },
  { text: "Hello, builder. What's it gonna be?" },
  { text: "Your AI coworker is clocked in." },
  { text: "Welcome back. Your tokens missed you." },
  { text: "So, what are we building today?" },
  { text: "Fire away. I'll clean up the mess." },
  { text: "New chat, who dis?" },
  { text: "Ready when you are." },
  { text: "Let's cook." },
  { text: "Prompt responsibly. Or don't." },
  { text: "Unlimited tokens, zero judgment." },
  { text: "What's on your mind?" },
  { text: "Type your heart out." },
  { text: "Go ahead. Make me generate something." },
  { text: "I'm literally built for this. Go on." },
  { text: "Chats are cheap. Type something interesting." },
  { text: "Beep boop. Ready to prompt." },
  { text: "What if we just — yeah, type it." },
  { text: "Go ahead. Type the thing." },
  { text: "You type, I respond. The circle of life." },
  { text: "This is fine. Everything is fine. Type away." },
  { text: "Your prompt is my command. Literally." },
  { text: "No prompt too small. No ask too weird." },
  { text: "Let's make something people actually use." },
  { text: "Type. It's free." },
  { text: "Let's make some magic happen." },
  { text: "Don't overthink it. Just type." },
  { text: "New conversation. Infinite potential." },
  { text: "Hello, world." },
];

// ─── Display messages — shown occasionally in larger font ───

const displayMessages: WelcomeMessage[] = [
  { text: "Let's build something ridiculous.", display: true },
  { text: "So many tokens, so little time.", display: true },
  { text: "You bring the ideas. I'll bring the compute.", display: true },
  { text: "Another day, another 100K tokens.", display: true },
  { text: "Type something. Anything. Zero judgment.", display: true },
  { text: "You had me at 'hello world'.", display: true },
  { text: "Let's write code future us will thank us for.", display: true },
  { text: "Warning: may cause sudden bursts of productivity.", display: true },
  { text: "The prompt is strong with this one.", display: true },
  { text: "Do NOT go gentle into that good prompt.", display: true },
  { text: "I'm not a regular LLM, I'm a cool LLM.", display: true },
  { text: "Welcome. Prepare to be prompted.", display: true },
];

// ─── Pick a random element from an array ───

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Public API ───

export interface WelcomeMessageResult {
  message: WelcomeMessage;
  period: string;
}

export function getWelcomeMessage(): WelcomeMessageResult {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();

  let period: string;
  let pool: WelcomeMessage[];

  if (hour >= 5 && hour < 7) { period = "dawn"; pool = dawn; }
  else if (hour >= 7 && hour < 11) { period = "morning"; pool = morning; }
  else if (hour >= 11 && hour < 12) { period = "preNoon"; pool = preNoon; }
  else if (hour >= 12 && hour < 17) { period = "afternoon"; pool = afternoon; }
  else if (hour >= 17 && hour < 20) { period = "evening"; pool = evening; }
  else if (hour >= 20) { period = "night"; pool = night; }
  else { period = "witching"; pool = witching; }

  if (Math.random() < 0.12) {
    return { message: pick(displayMessages), period: "display" };
  }

  if (Math.random() < 0.15) {
    const dayPool = weekday[dayOfWeek];
    if (dayPool && dayPool.length > 0) {
      return { message: pick(dayPool), period: `weekday-${dayOfWeek}` };
    }
  }

  if (Math.random() < 0.5) {
    return { message: pick(pool), period };
  }

  return { message: pick(anytime), period: "anytime" };
}

export function getMessageCount(): number {
  const pools = [
    dawn, morning, preNoon, afternoon, evening, night, witching,
    ...Object.values(weekday).flat(),
    anytime, displayMessages,
  ];
  return pools.flat().length;
}
