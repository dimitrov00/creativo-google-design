import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  Badge,
  BadgeTone,
  Button,
  ButtonVariant,
  Card,
  Input,
  MaterialDirective,
  MaterialTier,
  ShapeDirective,
  ShapeKind,
} from '@creativo/shared/ui';

@Component({
  selector: 'cr-gallery-page',
  imports: [Button, Input, Card, Badge, MaterialDirective, ShapeDirective],
  templateUrl: './gallery.page.html',
  styleUrl: './gallery.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryPage {
  protected readonly variants: ButtonVariant[] = [
    'primary',
    'accent',
    'secondary',
    'ghost',
    'outline',
    'destructive',
  ];
  protected readonly tones: BadgeTone[] = [
    'neutral',
    'accent',
    'success',
    'warning',
    'danger',
  ];
  protected readonly materialTiers: MaterialTier[] = [
    'none',
    'ultra-thin',
    'thin',
    'regular',
    'thick',
    'ultra-thick',
  ];
  protected readonly showAllCards = signal(true);
  protected readonly shapeTiles: { shape: ShapeKind; hover: ShapeKind }[] = [
    { shape: 'square', hover: 'circle' },
    { shape: 'rectangle', hover: 'roundedRectangle' },
    { shape: 'circle', hover: 'square' },
  ];
}
