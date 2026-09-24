
import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Trash2, Eye, EyeOff } from 'lucide-react';
import ProductVariationsButton from './ProductVariationsButton';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description?: string;
  image_url?: string;
  available?: boolean;
  show_in_pdv?: boolean;
  show_in_delivery?: boolean;
  send_to_kds?: boolean;
  preparation_route?: 'kitchen' | 'bar' | 'none';
}

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  onToggleAvailability: (id: string, available: boolean) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ 
  product, 
  onEdit, 
  onDelete, 
  onToggleAvailability 
}) => {
  const [imageError, setImageError] = useState(false);

  const imageUrl = useMemo(() => {
    return normalizeImageUrlForDisplay(product.image_url);
  }, [product.image_url]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  return (
    <Card className="h-full flex flex-col">
      {imageUrl && !imageError && (
        <div className="aspect-video w-full overflow-hidden rounded-t-lg">
          <img
            src={imageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        </div>
      )}
      
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-base leading-tight">{product.name}</CardTitle>
          <div className="flex gap-1 flex-wrap">
            {!product.available && (
              <Badge variant="destructive" className="text-xs">
                Indisponível
              </Badge>
            )}
            {product.show_in_pdv && (
              <Badge variant="outline" className="text-xs">
                PDV
              </Badge>
            )}
            {product.show_in_delivery && (
              <Badge variant="outline" className="text-xs">
                Delivery
              </Badge>
            )}
            {(product.preparation_route || (product.send_to_kds ? 'kitchen' : 'none')) !== 'none' && (
              <Badge variant="secondary" className="text-xs">
                {(product.preparation_route || 'kitchen') === 'bar' ? 'Bar/Copa' : 'Cozinha'}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col">
        <div className="flex-1">
          <p className="text-lg font-bold text-primary mb-2">
            {formatCurrency(product.price)}
          </p>
          <p className="text-xs text-gray-600 mb-2">
            Categoria: {product.category}
          </p>
          {product.description && (
            <p className="text-sm text-gray-700 line-clamp-2">
              {product.description}
            </p>
          )}
        </div>
        
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <ProductVariationsButton productId={product.id} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleAvailability(product.id, !product.available)}
            >
              {product.available ? <Eye size={14} /> : <EyeOff size={14} />}
            </Button>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(product)}
              className="flex-1"
            >
              <Edit size={14} className="mr-1" />
              Editar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDelete(product.id)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProductCard;
