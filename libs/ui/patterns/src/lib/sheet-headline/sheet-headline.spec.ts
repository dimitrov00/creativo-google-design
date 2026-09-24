import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UiSheetHeadline } from './sheet-headline';

@Component({
  imports: [UiSheetHeadline],
  template: `
    <ui-sheet-headline [uiFolded]="folded()">
      <h2 uiSheetLargeTitle id="t">Добави услуга</h2>
      <p>За Кирил Тодоров</p>
    </ui-sheet-headline>
  `,
})
class Host {
  readonly folded = signal(false);
}

describe('UiSheetHeadline', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it("holds the title and its one line in one body, and folds on the owner's word", () => {
    const host = fixture.nativeElement.querySelector(
      'ui-sheet-headline',
    ) as HTMLElement;
    const body = host.querySelector('.ui-sheet-headline__body');
    expect(body?.querySelector('h2')?.textContent).toBe('Добави услуга');
    expect(body?.querySelector('p')?.textContent).toBe('За Кирил Тодоров');
    expect(host.hasAttribute('data-folded')).toBe(false);
    fixture.componentInstance.folded.set(true);
    fixture.detectChanges();
    expect(host.hasAttribute('data-folded')).toBe(true);
  });
});
