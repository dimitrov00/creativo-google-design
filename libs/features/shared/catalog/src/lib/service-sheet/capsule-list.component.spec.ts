import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CapsuleListComponent, type CapsuleVm } from './capsule-list.component';

const OPTIONS: readonly CapsuleVm[] = [
  { label: 'Дълга коса', icon: 'service.variant.length' },
  { label: 'Чувствителна кожа', icon: 'service.variant.skin' },
  { label: 'Без измиване' },
];

describe('CapsuleListComponent', () => {
  let fixture: ComponentFixture<CapsuleListComponent>;
  const host = (): HTMLElement => fixture.nativeElement;
  const capsules = (): HTMLElement[] =>
    Array.from(host().querySelectorAll<HTMLElement>('[role="listitem"]'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CapsuleListComponent],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    fixture = TestBed.createComponent(CapsuleListComponent);
    fixture.componentRef.setInput('heading', 'Опции');
    fixture.componentRef.setInput('items', OPTIONS);
    fixture.detectChanges();
  });

  it('heads a list of static capsules, one per option, in order', () => {
    expect(host().querySelector('h3')?.textContent?.trim()).toBe('Опции');
    expect(host().querySelector('[role="list"]')).not.toBeNull();
    expect(capsules().map((capsule) => capsule.textContent?.trim())).toEqual([
      'Дълга коса',
      'Чувствителна кожа',
      'Без измиване',
    ]);
    for (const capsule of capsules()) {
      expect(capsule.tagName).toBe('SPAN');
      expect(capsule.classList.contains('ui-badge')).toBe(true);
      expect(capsule.getAttribute('data-size')).toBe('large');
    }
  });

  it("leads with the badge's OWN glyph — one per capsule, none hand-projected", () => {
    const [length, skin, plain] = capsules();
    for (const [capsule, name] of [
      [length, 'service.variant.length'],
      [skin, 'service.variant.skin'],
    ] as const) {
      const glyphs = capsule?.querySelectorAll('ui-icon') ?? [];
      expect(glyphs.length).toBe(1);
      expect(capsule?.firstElementChild).toBe(glyphs[0]);
      expect(glyphs[0]?.classList.contains('ui-badge__glyph')).toBe(true);
      expect(glyphs[0]?.getAttribute('data-name')).toBe(name);
    }
    expect(plain?.querySelector('ui-icon')).toBeNull();
  });
});
