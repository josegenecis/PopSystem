import React from 'react';
import { cn } from '@/lib/utils';

interface Category {
  id: string;
  name: string;
  image_url?: string | null;
}

interface CategoryTabsProps {
  categories: Category[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}

const CategoryTabs: React.FC<CategoryTabsProps> = ({ 
  categories, 
  activeCategory, 
  onCategoryChange 
}) => {
  const scrollToCategory = (categoryId: string) => {
    const element = document.getElementById(`category-${categoryId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    onCategoryChange(categoryId);
  };

  return (
    <div className="scrollbar-hide flex gap-2 overflow-x-auto px-0.5 py-2.5 sm:gap-5 sm:py-3">
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => scrollToCategory(category.id)}
          className={cn(
            "group flex w-[48px] flex-shrink-0 flex-col items-center gap-1.5 text-center text-[9px] font-bold sm:w-[82px] sm:gap-2 sm:text-xs",
            activeCategory === category.id
              ? "text-[var(--menu-secondary,#063D2E)]"
              : "text-slate-600"
          )}
        >
          <span className={cn('flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 bg-white p-0.5 shadow-sm transition-all sm:h-[72px] sm:w-[72px] sm:p-1', activeCategory === category.id ? 'scale-105 border-[var(--menu-primary,#85C441)] shadow-md' : 'border-white group-hover:border-[var(--menu-primary,#85C441)]/40')}>
            {category.image_url ? <img src={category.image_url} alt="" className="h-full w-full rounded-full object-cover" loading="lazy" /> : <span className="flex h-full w-full items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--menu-primary,#85C441)_14%,white)] text-lg font-black">{category.name.slice(0, 2).toUpperCase()}</span>}
          </span>
          <span className="line-clamp-2 min-h-[22px] leading-tight sm:min-h-0">{category.name}</span>
        </button>
      ))}
    </div>
  );
};

export default CategoryTabs;
