/**
 * Memory Generator
 * 
 * Generates memory and personality files from onboarding data.
 * These files are written to the container volume so the OpenClaw agent
 * starts with brand context, tone, and operator instructions.
 */

export interface OnboardingData {
  operatorName: string;
  brand: {
    name: string;
    industry: string;
    description: string;
    website: string;
  };
  tone: string;
  connectedApps: string[];
}

/**
 * Map tone selection to natural language descriptions.
 */
const TONE_MAP: Record<string, { label: string; description: string }> = {
  professional: {
    label: 'Professional',
    description: 'Formal, clear, and authoritative. Uses industry terminology. Avoids slang or casual expressions.',
  },
  friendly: {
    label: 'Friendly & Approachable',
    description: 'Warm, conversational, and encouraging. Uses simple language. Feels like a helpful colleague.',
  },
  bold: {
    label: 'Bold & Provocative',
    description: 'Direct, confident, and edgy. Not afraid to challenge the status quo. Uses strong verbs and punchy sentences.',
  },
  creative: {
    label: 'Creative & Playful',
    description: 'Imaginative, witty, and fun. Loves metaphors and wordplay. Makes content memorable and shareable.',
  },
};

/**
 * Map industry values to marketing context hints.
 */
const INDUSTRY_CONTEXT: Record<string, string> = {
  ecommerce: 'Focus on product descriptions, conversion-oriented copy, abandoned cart recovery, and seasonal campaigns.',
  saas: 'Emphasize value propositions, feature announcements, onboarding sequences, and product-led growth content.',
  agency: 'Adapt to multiple client voices. Focus on case studies, thought leadership, and results-driven messaging.',
  local: 'Prioritize local SEO, community engagement, event promotion, and customer reviews/testimonials.',
  personal: 'Build personal authority. Focus on storytelling, authentic voice, and audience relationship building.',
  food: 'Visual-first content. Emphasize cravings, seasonal menus, reviews, and behind-the-scenes stories.',
  fitness: 'Motivational tone. Focus on transformations, community, challenges, and educational health content.',
  real_estate: 'Showcase listings with compelling narratives. Focus on lifestyle, neighborhood highlights, and market insights.',
  education: 'Informative and trustworthy. Focus on outcomes, accessibility, student stories, and expert positioning.',
  other: 'Adapt marketing strategies based on brand-specific context and goals.',
};

/**
 * Generates the brand memory file content.
 * Written to `~/.openclaw/memory/brand.md` in the container volume.
 */
export function generateBrandMemory(data: OnboardingData): string {
  const tone = TONE_MAP[data.tone] || TONE_MAP['professional'];
  const industryHint = INDUSTRY_CONTEXT[data.brand.industry] || INDUSTRY_CONTEXT['other'];

  const lines = [
    '# Brand Context',
    '',
    `**Operator Name:** ${data.operatorName}`,
    `**Company:** ${data.brand.name}`,
    `**Industry:** ${data.brand.industry}`,
  ];

  if (data.brand.description) {
    lines.push(`**Description:** ${data.brand.description}`);
  }

  if (data.brand.website) {
    lines.push(`**Website:** ${data.brand.website}`);
  }

  lines.push('');
  lines.push('## Communication Style');
  lines.push(`**Tone:** ${tone.label}`);
  lines.push(`${tone.description}`);

  lines.push('');
  lines.push('## Industry Notes');
  lines.push(industryHint);

  if (data.connectedApps.length > 0) {
    lines.push('');
    lines.push('## Connected Platforms');
    lines.push(`The following tools are connected and available: ${data.connectedApps.join(', ')}.`);
    lines.push('Prioritize creating content and campaigns for these platforms.');
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generates the system prompt for the OpenClaw agent.
 * Written to `~/.openclaw/system-prompt.md` in the container volume.
 */
export function generateSystemPrompt(data: OnboardingData): string {
  const tone = TONE_MAP[data.tone] || TONE_MAP['professional'];

  return `You are ${data.operatorName}, an AI marketing operator for ${data.brand.name}.

## Your Role
You are a hands-on marketing team member — not a consultant, not an assistant. You execute marketing tasks directly: writing copy, planning campaigns, analyzing data, and producing deliverables.

## Brand Identity
- **Company:** ${data.brand.name}
- **Industry:** ${data.brand.industry}
${data.brand.description ? `- **What they do:** ${data.brand.description}` : ''}
${data.brand.website ? `- **Website:** ${data.brand.website}` : ''}

## Communication Rules
- **Tone:** ${tone.label} — ${tone.description}
- Always write as if you ARE part of the ${data.brand.name} team
- Match the brand's voice in all outputs
- Be proactive: suggest next steps, flag opportunities, anticipate needs
- When given a vague request, ask one clarifying question max, then execute

## Operational Guidelines
- Produce ready-to-publish content, not drafts or outlines
- Include specific CTAs, hashtags, and formatting when relevant
- When analyzing data, lead with insights and actionable recommendations
- Keep responses concise — busy marketers don't read walls of text
- Use bullet points and headers for clarity

## What You Can Do
${data.connectedApps.length > 0 ? `You have access to: ${data.connectedApps.join(', ')}. Leverage these platforms actively.` : 'No platforms are connected yet. Focus on strategy, copywriting, and campaign planning until tools are connected.'}

## What You Cannot Do
- You cannot access the internet directly or browse URLs
- You cannot send emails or messages on behalf of the user
- You cannot make purchases or financial transactions
- Always be transparent about your limitations
`;
}

/**
 * Generates the extended OpenClaw config JSON including memory file paths.
 */
export function generateOpenClawConfigWithMemory(
  openclawModelId: string,
  hasMemory: boolean = true
): string {
  const config: Record<string, unknown> = {
    agent: {
      model: openclawModelId,
    },
  };

  if (hasMemory) {
    config.memory = {
      brandFile: '/home/node/.openclaw/memory/brand.md',
      systemPromptFile: '/home/node/.openclaw/system-prompt.md',
    };
  }

  return JSON.stringify(config, null, 2);
}
