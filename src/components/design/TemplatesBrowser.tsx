/**
 * TemplatesBrowser — UI for browsing and selecting design templates.
 * 
 * Templates are pre-configured starting points that combine a skill
 * with recommended design system, direction, and content structure.
 */

import { useState, useMemo } from 'react';
import { 
  listTemplates, 
  searchTemplates, 
  getAllTags, 
  getTemplatesByTag,
  listTemplatesByCategory,
  type DesignTemplate,
  type TemplateCategory
} from '../../lib/design/templates';
import { getSkill } from '../../lib/design/skills';
import { getDesignSystem } from '../../lib/design/systems';
import { Search, Tag, Sparkles, X } from 'lucide-react';

interface TemplatesBrowserProps {
  onSelect: (template: DesignTemplate) => void;
  onClose?: () => void;
}

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  landing: 'Landing Pages',
  presentation: 'Presentations',
  dashboard: 'Dashboards',
  document: 'Documents',
  marketing: 'Marketing',
  social: 'Social Media',
  email: 'Email',
  mobile: 'Mobile',
};

const CATEGORY_ICONS: Record<TemplateCategory, string> = {
  landing: '🌐',
  presentation: '📊',
  dashboard: '📈',
  document: '📄',
  marketing: '📢',
  social: '📱',
  email: '✉️',
  mobile: '📱',
};

export function TemplatesBrowser({ onSelect, onClose }: TemplatesBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | 'all'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  const allTags = useMemo(() => getAllTags(), []);
  
  const filteredTemplates = useMemo(() => {
    let templates: DesignTemplate[];
    
    if (searchQuery) {
      templates = searchTemplates(searchQuery);
    } else if (selectedTag) {
      templates = getTemplatesByTag(selectedTag);
    } else if (selectedCategory !== 'all') {
      templates = listTemplatesByCategory(selectedCategory);
    } else {
      templates = listTemplates();
    }
    
    return templates;
  }, [searchQuery, selectedCategory, selectedTag]);
  
  const groupedTemplates = useMemo(() => {
    const groups: Record<TemplateCategory, DesignTemplate[]> = {
      landing: [],
      presentation: [],
      dashboard: [],
      document: [],
      marketing: [],
      social: [],
      email: [],
      mobile: [],
    };
    
    filteredTemplates.forEach(t => {
      groups[t.category].push(t);
    });
    
    return groups;
  }, [filteredTemplates]);
  
  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-text-1 flex items-center gap-2">
              <Sparkles size={18} className="text-accent" />
              Design Templates
            </h2>
            <p className="text-[12px] text-text-3 mt-1">
              Pre-configured starting points for common design patterns
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="control-icon flex h-7 w-7 items-center justify-center rounded-md"
              aria-label="Close templates"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
        
        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedTag(null);
            }}
            placeholder="Search templates..."
            className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-[13px] text-text-1 placeholder:text-text-3 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
          />
        </div>
        
        {/* Category filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => {
              setSelectedCategory('all');
              setSelectedTag(null);
            }}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-md whitespace-nowrap ${
              selectedCategory === 'all' && !selectedTag
                ? 'primary-action'
                : 'control-pill'
            }`}
          >
            All
          </button>
          {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(cat as TemplateCategory);
                setSelectedTag(null);
              }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md whitespace-nowrap ${
                selectedCategory === cat && !selectedTag
                  ? 'primary-action'
                  : 'control-pill'
              }`}
            >
              {CATEGORY_ICONS[cat as TemplateCategory]} {label}
            </button>
          ))}
        </div>
        
        {/* Tags */}
        {!searchQuery && selectedCategory === 'all' && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Tag size={12} className="text-text-3" />
            {allTags.slice(0, 15).map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  selectedTag === tag
                    ? 'border border-accent/25 bg-accent/15 text-accent'
                    : 'control-pill'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Template grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {Object.entries(groupedTemplates).map(([category, templates]) => {
          if (templates.length === 0) return null;
          
          return (
            <div key={category} className="mb-6">
              <h3 className="text-[13px] font-semibold text-text-2 mb-3 flex items-center gap-2">
                {CATEGORY_ICONS[category as TemplateCategory]}
                {CATEGORY_LABELS[category as TemplateCategory]}
                <span className="text-[11px] text-text-3 font-normal">
                  ({templates.length})
                </span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {templates.map(template => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onClick={() => onSelect(template)}
                  />
                ))}
              </div>
            </div>
          );
        })}
        
        {filteredTemplates.length === 0 && (
          <div className="flex items-center justify-center h-32 text-text-3">
            <p className="text-[13px]">No templates found</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface TemplateCardProps {
  template: DesignTemplate;
  onClick: () => void;
}

function TemplateCard({ template, onClick }: TemplateCardProps) {
  const skill = getSkill(template.skillId);
  const system = getDesignSystem(template.recommendedSystemId);
  
  return (
    <button
      onClick={onClick}
      className="soft-card flex flex-col p-4 rounded-lg hover:bg-white/5 hover:border-accent/30 transition-colors text-left group"
    >
      <h4 className="text-[13px] font-semibold text-text-1 mb-1 group-hover:text-accent">
        {template.name}
      </h4>
      <p className="text-[11px] text-text-3 mb-3 line-clamp-2">
        {template.description}
      </p>
      <div className="flex items-center gap-2 mt-auto">
        {skill && (
          <span className="px-2 py-0.5 text-[10px] bg-white/5 text-text-3 border border-hairline rounded">
            {skill.name}
          </span>
        )}
        {system && (
          <span className="px-2 py-0.5 text-[10px] bg-accent/10 text-accent border border-accent/20 rounded">
            {system.name}
          </span>
        )}
      </div>
    </button>
  );
}
