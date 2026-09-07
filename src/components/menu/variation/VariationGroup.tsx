import React from 'react';
import { Label } from '@/components/ui/label';
import { formatBRL } from '@/lib/currency';
import { VariationOptionItem } from './VariationOptionItem';
import { CheckCircle2 } from 'lucide-react';

interface VariationOption {
  name: string;
  price: number;
  display_price?: number;
  recommended?: boolean;
}

interface ProductVariation {
  id: string;
  name: string;
  customer_label?: string;
  required: boolean;
  min_selections: number;
  max_selections: number;
  standard_max_selections?: number;
  free_selections_limit?: number;
  allow_paid_excess?: boolean;
  paid_max_selections?: number;
  pricing_mode?: 'default' | 'free' | 'half' | 'multiplier' | 'fixed';
  price_multiplier?: number;
  fixed_option_price?: number | null;
  options: VariationOption[];
}

interface VariationGroupProps {
  variation: ProductVariation;
  selectedVariations: Record<string, string[]>;
  onVariationChange: (variationId: string, optionName: string, isSelected: boolean) => void;
}

export const VariationGroup: React.FC<VariationGroupProps> = ({
  variation,
  selectedVariations,
  onVariationChange
}) => {
  const selectedOptions = selectedVariations[variation.id] || [];
  const minSel = Math.max(variation.required ? 1 : 0, Number(variation.min_selections || 0));
  const maxSel = Math.max(1, Number(variation.max_selections || 1));
  const baseMax = Math.max(1, Number(variation.standard_max_selections || maxSel));
  const freeLimit = Math.max(0, Number(variation.free_selections_limit || 0));
  const count = selectedOptions.length;
  const reachedMax = count >= maxSel;
  const isValid = count >= minSel && count <= maxSel;

  const selectionInstruction = minSel > 0
    ? maxSel > 1
      ? `Selecione de ${minSel} a ${maxSel} opções`
      : 'Selecione 1 opção'
    : maxSel > 1
      ? `Selecione até ${maxSel} opções`
      : 'Opcional';
  const freeSelectionHint = freeLimit > 0
    ? freeLimit >= maxSel
      ? maxSel === 1
        ? 'esta opção será grátis'
        : 'todas serão grátis'
      : freeLimit === 1
        ? `a primeira será grátis${variation.allow_paid_excess ? '; as demais serão cobradas' : ''}`
        : `as primeiras ${freeLimit} serão grátis${variation.allow_paid_excess ? '; as demais serão cobradas' : ''}`
    : '';
  const paidExcessHint = !freeSelectionHint && variation.allow_paid_excess && maxSel > baseMax
    ? `até ${baseMax} no limite padrão; as demais serão cobradas`
    : '';
  const subtitle = `${selectionInstruction}${freeSelectionHint || paidExcessHint ? ` (${freeSelectionHint || paidExcessHint})` : ''}`;
  const pricingHint =
    variation.pricing_mode === 'free'
      ? 'Sem custo neste produto'
      : variation.pricing_mode === 'half'
        ? 'Itens cobrados pela metade'
        : variation.pricing_mode === 'multiplier'
          ? `${Number(variation.price_multiplier || 1).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x sobre o preço base`
          : variation.pricing_mode === 'fixed'
            ? `${formatBRL(variation.fixed_option_price || 0)} por item`
            : '';

  return (
    <div className="border rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Label className="font-semibold text-gray-900">
          {variation.customer_label || variation.name} {variation.required && <span className="text-red-500">*</span>}
          </Label>
          <div className="text-xs text-muted-foreground mt-0.5">
            {subtitle}
          </div>
          {pricingHint && (
            <div className="text-xs text-orange-600 mt-1">
              {pricingHint}
            </div>
          )}
        </div>
        {isValid && minSel > 0 && (
          <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
        )}
      </div>
      
      <div className="mt-3 divide-y divide-gray-100">
        {variation.options.map((option, index) => {
          const selectedCount = selectedOptions.filter((name) => name === option.name).length;
          const addDisabled = reachedMax;
          const hidePriceLabel = variation.pricing_mode === 'free' || freeLimit > 0;
          return (
            <VariationOptionItem
              key={`${variation.id}-${index}`}
              option={option}
              selectedCount={selectedCount}
              freeSelectionsLimit={freeLimit}
              hidePriceLabel={hidePriceLabel}
              addDisabled={addDisabled}
              removeDisabled={selectedCount === 0}
              onAdd={() => onVariationChange(variation.id, option.name, true)}
              onRemove={() => onVariationChange(variation.id, option.name, false)}
            />
          );
        })}
      </div>
    </div>
  );
};
