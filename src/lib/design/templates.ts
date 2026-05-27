/**
 * Design templates — pre-built starting points for common design patterns.
 * 
 * Unlike skills (which are general-purpose), templates are specific starting points
 * that combine a skill with pre-configured content and structure.
 * 
 * Adapted from open-design's ~110 templates.
 */

export type TemplateCategory = 
  | 'landing'
  | 'presentation'
  | 'dashboard'
  | 'document'
  | 'marketing'
  | 'social'
  | 'email'
  | 'mobile';

export interface DesignTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  /** The skill this template is based on */
  skillId: string;
  /** Preview thumbnail or description */
  preview?: string;
  /** Pre-configured content to start with */
  initialContent?: string;
  /** Recommended design system */
  recommendedSystemId?: string;
  /** Recommended direction */
  recommendedDirectionId?: string;
  /** Tags for filtering */
  tags?: string[];
}

export const TEMPLATES: DesignTemplate[] = [
  // Landing pages
  {
    id: 'saas-landing-hero',
    name: 'SaaS Landing with Hero',
    category: 'landing',
    description: 'Modern SaaS landing page with hero section, features, and CTA',
    skillId: 'saas-landing',
    recommendedSystemId: 'linear-app',
    recommendedDirectionId: 'modern-minimal',
    tags: ['saas', 'hero', 'features', 'cta'],
  },
  {
    id: 'product-launch',
    name: 'Product Launch Page',
    category: 'landing',
    description: 'High-impact product launch announcement page',
    skillId: 'web-prototype',
    recommendedSystemId: 'vercel',
    recommendedDirectionId: 'brutalist-experimental',
    tags: ['launch', 'product', 'announcement'],
  },
  {
    id: 'portfolio-showcase',
    name: 'Portfolio Showcase',
    category: 'landing',
    description: 'Creative portfolio with project grid and case studies',
    skillId: 'web-prototype',
    recommendedSystemId: 'framer',
    recommendedDirectionId: 'editorial-monocle',
    tags: ['portfolio', 'creative', 'showcase'],
  },
  
  // Presentations
  {
    id: 'pitch-deck',
    name: 'Startup Pitch Deck',
    category: 'presentation',
    description: 'Investor pitch deck with problem, solution, market, team slides',
    skillId: 'simple-deck',
    recommendedSystemId: 'stripe',
    recommendedDirectionId: 'modern-minimal',
    tags: ['pitch', 'startup', 'investor', 'funding'],
  },
  {
    id: 'quarterly-review',
    name: 'Quarterly Business Review',
    category: 'presentation',
    description: 'QBR presentation with metrics, achievements, and roadmap',
    skillId: 'simple-deck',
    recommendedSystemId: 'linear-app',
    recommendedDirectionId: 'tech-utility',
    tags: ['qbr', 'business', 'metrics', 'roadmap'],
  },
  {
    id: 'tech-talk',
    name: 'Technical Talk',
    category: 'presentation',
    description: 'Conference-style tech talk with code examples',
    skillId: 'simple-deck',
    recommendedSystemId: 'vercel',
    recommendedDirectionId: 'tech-utility',
    tags: ['tech', 'conference', 'code', 'talk'],
  },
  
  // Dashboards
  {
    id: 'analytics-dashboard',
    name: 'Analytics Dashboard',
    category: 'dashboard',
    description: 'Data analytics dashboard with charts and KPIs',
    skillId: 'dashboard',
    recommendedSystemId: 'linear-app',
    recommendedDirectionId: 'tech-utility',
    tags: ['analytics', 'data', 'charts', 'kpi'],
  },
  {
    id: 'admin-panel',
    name: 'Admin Control Panel',
    category: 'dashboard',
    description: 'Admin interface with user management and settings',
    skillId: 'dashboard',
    recommendedSystemId: 'ant',
    recommendedDirectionId: 'tech-utility',
    tags: ['admin', 'management', 'settings'],
  },
  
  // Documents
  {
    id: 'api-documentation',
    name: 'API Documentation',
    category: 'document',
    description: 'Technical API docs with endpoints, examples, and SDKs',
    skillId: 'docs-page',
    recommendedSystemId: 'stripe',
    recommendedDirectionId: 'modern-minimal',
    tags: ['api', 'docs', 'technical', 'developer'],
  },
  {
    id: 'design-spec',
    name: 'Design Specification',
    category: 'document',
    description: 'Detailed design spec with components, colors, and typography',
    skillId: 'docs-page',
    recommendedSystemId: 'figma',
    recommendedDirectionId: 'editorial-monocle',
    tags: ['design', 'spec', 'components', 'style-guide'],
  },
  
  // Marketing
  {
    id: 'case-study',
    name: 'Customer Case Study',
    category: 'marketing',
    description: 'Customer success story with metrics and testimonials',
    skillId: 'blog-post',
    recommendedSystemId: 'hubspot',
    recommendedDirectionId: 'editorial-monocle',
    tags: ['case-study', 'customer', 'success', 'testimonial'],
  },
  {
    id: 'pricing-comparison',
    name: 'Pricing Comparison Table',
    category: 'marketing',
    description: 'Detailed pricing table with feature comparison',
    skillId: 'pricing-page',
    recommendedSystemId: 'stripe',
    recommendedDirectionId: 'modern-minimal',
    tags: ['pricing', 'comparison', 'plans', 'features'],
  },
  
  // Social
  {
    id: 'twitter-thread',
    name: 'Twitter Thread Cards',
    category: 'social',
    description: 'Thread-style social media cards for storytelling',
    skillId: 'social-carousel',
    recommendedSystemId: 'twitter',
    recommendedDirectionId: 'modern-minimal',
    tags: ['twitter', 'social', 'thread', 'storytelling'],
  },
  {
    id: 'instagram-carousel',
    name: 'Instagram Carousel',
    category: 'social',
    description: 'Multi-slide Instagram post with educational content',
    skillId: 'social-carousel',
    recommendedSystemId: 'instagram',
    recommendedDirectionId: 'editorial-monocle',
    tags: ['instagram', 'carousel', 'educational'],
  },
  
  // Email
  {
    id: 'newsletter-template',
    name: 'Newsletter Template',
    category: 'email',
    description: 'Email newsletter with articles, updates, and CTAs',
    skillId: 'email-template',
    recommendedSystemId: 'mailchimp',
    recommendedDirectionId: 'editorial-monocle',
    tags: ['email', 'newsletter', 'updates'],
  },
  {
    id: 'product-update-email',
    name: 'Product Update Email',
    category: 'email',
    description: 'Announce new features and improvements via email',
    skillId: 'email-template',
    recommendedSystemId: 'linear-app',
    recommendedDirectionId: 'modern-minimal',
    tags: ['email', 'product', 'update', 'announcement'],
  },
  
  // Mobile
  {
    id: 'app-onboarding',
    name: 'App Onboarding Flow',
    category: 'mobile',
    description: 'Mobile app onboarding screens with illustrations',
    skillId: 'mobile-onboarding',
    recommendedSystemId: 'airbnb',
    recommendedDirectionId: 'human-approachable',
    tags: ['mobile', 'app', 'onboarding', 'welcome'],
  },
  {
    id: 'mobile-dashboard',
    name: 'Mobile Dashboard',
    category: 'mobile',
    description: 'Mobile-optimized dashboard with key metrics',
    skillId: 'mobile-app',
    recommendedSystemId: 'linear-app',
    recommendedDirectionId: 'modern-minimal',
    tags: ['mobile', 'dashboard', 'metrics', 'app'],
  },
];

/**
 * Get a template by ID
 */
export function getTemplate(id: string): DesignTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

/**
 * List all templates
 */
export function listTemplates(): DesignTemplate[] {
  return TEMPLATES;
}

/**
 * List templates by category
 */
export function listTemplatesByCategory(category: TemplateCategory): DesignTemplate[] {
  return TEMPLATES.filter(t => t.category === category);
}

/**
 * Search templates by name, description, or tags
 */
export function searchTemplates(query: string): DesignTemplate[] {
  const lowerQuery = query.toLowerCase();
  return TEMPLATES.filter(t => 
    t.name.toLowerCase().includes(lowerQuery) ||
    t.description.toLowerCase().includes(lowerQuery) ||
    t.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get all unique tags
 */
export function getAllTags(): string[] {
  const tags = new Set<string>();
  TEMPLATES.forEach(t => t.tags?.forEach(tag => tags.add(tag)));
  return Array.from(tags).sort();
}

/**
 * Get templates by tag
 */
export function getTemplatesByTag(tag: string): DesignTemplate[] {
  return TEMPLATES.filter(t => t.tags?.includes(tag));
}
