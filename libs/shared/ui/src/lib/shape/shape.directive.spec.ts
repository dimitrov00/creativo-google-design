import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShapeDirective, ShapeKind } from './shape.directive';

@Component({
  imports: [ShapeDirective],
  template: `<img
    [crShape]="shape()"
    [crShapeHover]="hoverShape()"
    src="/photo.jpg"
    alt=""
  />`,
})
class ShapeHost {
  readonly shape = signal<ShapeKind>('square');
  readonly hoverShape = signal<ShapeKind | undefined>(undefined);
}

describe('ShapeDirective', () => {
  let fixture: ComponentFixture<ShapeHost>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShapeHost],
    }).compileComponents();

    fixture = TestBed.createComponent(ShapeHost);
    fixture.detectChanges();
    host = fixture.nativeElement.querySelector('img');
  });

  it('sets --cr-shape-radius to a fixed 0 for rectangle/square shapes', () => {
    expect(host.style.getPropertyValue('--cr-shape-radius')).toBe(
      'var(--cr-radius-none)',
    );
  });

  it('sets --cr-shape-radius to 50% for circle', () => {
    fixture.componentInstance.shape.set('circle');
    fixture.detectChanges();
    expect(host.style.getPropertyValue('--cr-shape-radius')).toBe('50%');
  });

  it('sets --cr-shape-radius to the full-pill token for capsule', () => {
    fixture.componentInstance.shape.set('capsule');
    fixture.detectChanges();
    expect(host.style.getPropertyValue('--cr-shape-radius')).toBe(
      'var(--cr-radius-full)',
    );
  });

  it('forces a 1:1 aspect ratio for circle/square, not for rectangle/capsule', () => {
    expect(host.style.getPropertyValue('aspect-ratio')).toBe('1');

    fixture.componentInstance.shape.set('rectangle');
    fixture.detectChanges();
    expect(host.style.getPropertyValue('aspect-ratio')).toBe('');
  });

  it('has no hover morph attribute/property until a crShapeHover is bound', () => {
    expect(host.hasAttribute('data-cr-shape-morphs')).toBe(false);
    expect(host.style.getPropertyValue('--cr-shape-hover-radius')).toBe('');
  });

  it('exposes --cr-shape-hover-radius and the morph attribute once crShapeHover is set', () => {
    fixture.componentInstance.hoverShape.set('circle');
    fixture.detectChanges();
    expect(host.hasAttribute('data-cr-shape-morphs')).toBe(true);
    expect(host.style.getPropertyValue('--cr-shape-hover-radius')).toBe('50%');
  });
});
