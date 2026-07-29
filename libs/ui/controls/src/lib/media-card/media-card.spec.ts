import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiMediaCard } from './media-card';

@Component({
  imports: [UiMediaCard],
  template: `
    <ui-media-card
      data-testid="card"
      uiRadius="prominent"
      uiRatio="1 / 1"
      [uiSrc]="src()"
      uiAlt="cover"
    >
      <span uiPlaceholder class="motif">scissors</span>
      <span uiCaption class="name">Classic cut</span>
      <span uiCaption class="meta">from 13 €</span>
      @if (bundle()) {
        <span uiOverlayTrailing class="chip">layers</span>
      }
      <span uiOverlayLeading class="info">i</span>
    </ui-media-card>
  `,
})
class HostComponent {
  src = signal<string | null>('/cover.jpg');
  bundle = signal(true);
}

describe('UiMediaCard', () => {
  let fixture: ComponentFixture<HostComponent>;
  let card: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    card = fixture.nativeElement.querySelector('[data-testid="card"]');
  });

  it('stamps the host class, the on-media context and the composed radius', () => {
    expect(card.classList.contains('ui-media-card')).toBe(true);
    expect(card.hasAttribute('data-on-media')).toBe(true);
    // Radius rides the shared uiRadius modifier via hostDirectives.
    expect(card.getAttribute('data-radius')).toBe('prominent');
  });

  it('drives ui-async-image from its own source/ratio inputs', () => {
    const image: HTMLElement | null = card.querySelector('ui-async-image');
    expect(image?.style.aspectRatio).toBe('1 / 1');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/cover.jpg');
  });

  it('forwards projected placeholder art into the image placeholder slot', () => {
    // The wrapper carries uiPlaceholder so ui-async-image matches it — a
    // bare nested <ng-content select> would never reach the child's slot.
    const placeholder = card.querySelector(
      '.ui-async-image__placeholder > .ui-media-card__placeholder',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder?.querySelector('.motif')).not.toBeNull();
  });

  it('collects every caption line into the one inset stack, in order', () => {
    const caption = card.querySelector('.ui-media-card__caption');
    expect(
      Array.from(caption?.children ?? []).map((el) => el.className),
    ).toEqual(['name', 'meta']);
  });

  it('renders the media scrim only while a caption is shown', () => {
    expect(card.querySelector('[data-overlay="scrim-media"]')).not.toBeNull();
  });

  it('projects corner accessories as direct children, conditionals included', () => {
    expect(card.querySelector(':scope > .info')).not.toBeNull();
    expect(card.querySelector(':scope > .chip')).not.toBeNull();

    fixture.componentInstance.bundle.set(false);
    fixture.detectChanges();
    expect(card.querySelector('.chip')).toBeNull();
  });
});
