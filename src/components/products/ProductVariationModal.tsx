
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { formatBRL } from '@/lib/currency';

interface ProductVariation {
  id: string;
  name: string;
  options: Array<{
    name: string;
    price: number;
  }>;
  required: boolean;
  max_selections: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  image_url?: string;
  variations?: ProductVariation[];
}

interface ProductVariationModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  onAddToCart: (product: Product, selectedVariations: any[], notes: string, quantity: number) => void;
}

const ProductVariationModal: React.FC<ProductVariationModalProps> = ({
  isOpen,
  onClose,
  product,
  onAddToCart
}) => {
  const [selectedVariations, setSelectedVariations] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);

  const handleVariationChange = (variationId: string, option: any, isMultiple: boolean) => {
    if (isMultiple) {
      const current = selectedVariations[variationId] || [];
      const exists = current.find((item: any) => item.name === option.name);
      
      if (exists) {
        setSelectedVariations({
          ...selectedVariations,
          [variationId]: current.filter((item: any) => item.name !== option.name)
        });
      } else {
        setSelectedVariations({
          ...selectedVariations,
          [variationId]: [...current, option]
        });
      }
    } else {
      setSelectedVariations({
        ...selectedVariations,
        [variationId]: option
      });
    }
  };

  const calculateTotal = () => {
    let total = product.price * quantity;
    
    Object.values(selectedVariations).forEach((variation: any) => {
      if (Array.isArray(variation)) {
        variation.forEach((option: any) => {
          total += option.price * quantity;
        });
      } else if (variation) {
        total += variation.price * quantity;
      }
    });
    
    return total;
  };

  const handleAddToCart = () => {
    const variationsArray = Object.entries(selectedVariations).map(([id, selection]) => ({
      variation_id: id,
      selection
    }));
    
    onAddToCart(product, variationsArray, notes, quantity);
    onClose();
    
    // Reset form
    setSelectedVariations({});
    setNotes('');
    setQuantity(1);
  };

  const canAddToCart = () => {
    if (!product.variations) return true;
    
    return product.variations.every(variation => {
      if (!variation.required) return true;
      return selectedVariations[variation.id];
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {product.image_url && (
            <img 
              src={product.image_url} 
              alt={product.name}
              className="w-full h-48 object-cover rounded-lg"
            />
          )}
          
          <div className="flex items-center gap-4">
            <Label>Quantidade:</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >
                -
              </Button>
              <span className="w-8 text-center">{quantity}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuantity(quantity + 1)}
              >
                +
              </Button>
            </div>
          </div>

          {product.variations?.map((variation) => (
            <div key={variation.id} className="space-y-2">
              <Label className="font-medium">
                {variation.name} {variation.required && '*'}
              </Label>
              
              {variation.max_selections === 1 ? (
                <RadioGroup
                  value={selectedVariations[variation.id]?.name || ''}
                  onValueChange={(value) => {
                    const option = variation.options.find(opt => opt.name === value);
                    if (option) {
                      handleVariationChange(variation.id, option, false);
                    }
                  }}
                >
                  {variation.options.map((option) => (
                    <div key={option.name} className="flex items-center space-x-2">
                      <RadioGroupItem value={option.name} id={`${variation.id}-${option.name}`} />
                      <Label htmlFor={`${variation.id}-${option.name}`} className="flex-1">
                        {option.name}
                        {option.price > 0 && (
                          <span className="text-green-600 ml-2">
                            +{formatBRL(option.price)}
                          </span>
                        )}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <div className="space-y-2">
                  {variation.options.map((option) => (
                    <div key={option.name} className="flex items-center space-x-2">
                      <Checkbox
                        id={`${variation.id}-${option.name}`}
                        checked={selectedVariations[variation.id]?.some((item: any) => item.name === option.name) || false}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            handleVariationChange(variation.id, option, true);
                          } else {
                            const current = selectedVariations[variation.id] || [];
                            setSelectedVariations({
                              ...selectedVariations,
                              [variation.id]: current.filter((item: any) => item.name !== option.name)
                            });
                          }
                        }}
                      />
                      <Label htmlFor={`${variation.id}-${option.name}`} className="flex-1">
                        {option.name}
                        {option.price > 0 && (
                          <span className="text-green-600 ml-2">
                            +{formatBRL(option.price)}
                          </span>
                        )}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Alguma observação especial..."
              rows={3}
            />
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <div className="text-lg font-bold">
              Total: {formatBRL(calculateTotal())}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button 
                onClick={handleAddToCart}
                disabled={!canAddToCart()}
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
