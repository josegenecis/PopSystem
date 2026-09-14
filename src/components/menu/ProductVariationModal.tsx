
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Minus, Plus } from 'lucide-react';
import { formatBRL } from '@/lib/currency';

interface Product {
  id: string;
  name: string;
  price: number;
  description?: string;
  image_url?: string;
  category_id?: string;
}

interface ProductVariation {
  id: string;
  name: string;
  options: Array<{
    name: string;
    price: number;
  }>;
  max_selections: number;
  required: boolean;
}

interface ProductVariationModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  variations: ProductVariation[];
  onAddToCart: (product: Product, quantity: number, selectedVariations: any[], notes: string) => void;
}

const ProductVariationModal: React.FC<ProductVariationModalProps> = ({
  isOpen,
  onClose,
  product,
  variations,
  onAddToCart
}) => {
  const [quantity, setQuantity] = useState(1);
  const [selectedVariations, setSelectedVariations] = useState<Record<string, any[]>>({});
  const [notes, setNotes] = useState('');

  console.log('🔄 ProductVariationModal renderizando:', {
    product: product?.name,
    variationsCount: variations?.length || 0,
    variations: variations
  });

  const handleVariationChange = (variationId: string, optionName: string, optionPrice: number, isSelected: boolean) => {
    const variation = variations.find(v => v.id === variationId);
    if (!variation) {
      console.error('❌ Variação não encontrada:', variationId);
      return;
    }

    console.log('🔄 Alterando variação:', {
      variationId,
      optionName,
      optionPrice,
      isSelected,
      maxSelections: variation.max_selections
    });

    setSelectedVariations(prev => {
      const current = prev[variationId] || [];
      
      if (variation.max_selections === 1) {
        // Radio button behavior - apenas uma seleção
        return {
          ...prev,
          [variationId]: isSelected ? [{ name: optionName, price: optionPrice }] : []
        };
      } else {
        // Checkbox behavior - múltiplas seleções
        if (isSelected) {
          if (current.length < variation.max_selections) {
            return {
              ...prev,
              [variationId]: [...current, { name: optionName, price: optionPrice }]
            };
          } else {
            console.log('⚠️ Limite máximo de seleções atingido');
            return prev;
          }
        } else {
          return {
            ...prev,
            [variationId]: current.filter((item: any) => item.name !== optionName)
          };
        }
      }
    });
  };

  const calculateTotalPrice = () => {
    let total = product.price * quantity;
    
    Object.values(selectedVariations).forEach((options: any[]) => {
      if (Array.isArray(options)) {
        options.forEach(option => {
          total += option.price * quantity;
        });
      }
    });
    
    console.log('💰 Cálculo de preço total:', {
      basePrice: product.price,
      quantity,
      variationPrice: total - (product.price * quantity),
      total
    });
    
    return total;
  };

  const canAddToCart = () => {
    const canAdd = variations.every(variation => {
      if (!variation.required) return true;
      const selected = selectedVariations[variation.id];
      return selected && selected.length > 0;
    });
    
    console.log('✅ Pode adicionar ao carrinho:', canAdd);
    return canAdd;
  };

  const handleAddToCart = () => {
    if (!canAddToCart()) {
      console.log('❌ Não pode adicionar - validação falhou');
      return;
    }

    // Transformar todas as opções selecionadas em um array plano de nomes de opções (strings) para onAddToCart, evitando duplicidade e problemas de exibição.
    const allSelectedOptions = Object.values(selectedVariations).flat().map(opt => opt.name);
    console.log('✅ Adicionando ao carrinho:', {
      product: product.name,
      quantity,
      selectedOptions: allSelectedOptions,
      notes
    });
    onAddToCart(product, quantity, allSelectedOptions, notes);

    // Reset form
    setQuantity(1);
    setSelectedVariations({});
    setNotes('');

    onClose();

  };

  if (!variations || variations.length === 0) {
    console.log('❌ Nenhuma variação encontrada, modal não deveria abrir');
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Personalizar {product.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Informações do Produto */}
          <div className="flex items-center gap-4">
            {product.image_url && (
              <img 
                src={product.image_url} 
                alt={product.name}
                className="w-20 h-20 object-cover rounded-lg"
              />
            )}
            <div>
              <h3 className="text-lg font-semibold">{product.name}</h3>
              {product.description && (
                <p className="text-sm text-muted-foreground">{product.description}</p>
              )}
              <p className="text-lg font-bold text-primary">
                {formatBRL(product.price)}
              </p>
            </div>
          </div>

          {/* Variações */}
          {variations.map(variation => (
            <Card key={variation.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {variation.name}
                  {variation.required && <span className="text-red-500 ml-1">*</span>}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {variation.max_selections === 1 
                    ? 'Selecione uma opção'
                    : `Selecione até ${variation.max_selections} opções`
                  }
                </p>
              </CardHeader>
              <CardContent>
                {variation.max_selections === 1 ? (
                  <RadioGroup
                    value={selectedVariations[variation.id]?.[0]?.name || ''}
                    onValueChange={(value) => {
                      const option = variation.options.find(opt => opt.name === value);
                      if (option) {
                        handleVariationChange(variation.id, option.name, option.price, true);
                      }
                    }}
                  >
                    {variation.options.map(option => (
                      <div key={option.name} className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value={option.name} id={`${variation.id}-${option.name}`} />
                          <Label htmlFor={`${variation.id}-${option.name}`}>{option.name}</Label>
                        </div>
                        {option.price > 0 && (
                          <span className="text-sm text-muted-foreground">
                            +{formatBRL(option.price)}
                          </span>
                        )}
                      </div>
                    ))}
                  </RadioGroup>
                ) : (
                  <div className="space-y-2">
                    {variation.options.map(option => {
                      const isSelected = selectedVariations[variation.id]?.some((item: any) => item.name === option.name) || false;
                      const isDisabled = !isSelected && (selectedVariations[variation.id]?.length || 0) >= variation.max_selections;
                      
                      return (
                        <div key={option.name} className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`${variation.id}-${option.name}`}
                              checked={isSelected}
                              disabled={isDisabled}
                              onCheckedChange={(checked) => 
                                handleVariationChange(variation.id, option.name, option.price, checked as boolean)
                              }
                            />
                            <Label 
                              htmlFor={`${variation.id}-${option.name}`}
                              className={isDisabled ? "text-muted-foreground" : ""}
                            >
                              {option.name}
                            </Label>
                          </div>
                          {option.price > 0 && (
                            <span className="text-sm text-muted-foreground">
                              +{formatBRL(option.price)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Observações */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                placeholder="Observações especiais..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Quantidade e Total */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="font-semibold text-lg">{quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setQuantity(quantity + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-xl font-bold text-primary">
                  {formatBRL(calculateTotalPrice())}
                </p>
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancelar
              </Button>
              <Button 
                onClick={handleAddToCart} 
                disabled={!canAddToCart()}
                className="flex-1"
              >
                Adicionar ao Carrinho
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductVariationModal;
