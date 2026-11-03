import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiMarkedText, type UiMarkedRun } from './marked-text';

@Component({
  imports: [UiMarkedText],
  template: `<span data-testid="line"
    ><ui-marked-text [uiRuns]="runs()"
  /></span>`,
})
class HostComponent {
  runs = signal<readonly UiMarkedRun[]>([
    { text: 'Ив', hit: true },
    { text: 'ан ', hit: false },
    { text: 'Пет', hit: true },
    { text: 'ров', hit: false },
  ]);
}

describe('UiMarkedText', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const line = (): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="line"]');

  it('marks the hit runs and prints the others as plain text, in order', () => {
    const marks = Array.from(line().querySelectorAll('mark')).map(
      (mark) => mark.textContent,
    );
    expect(marks).toEqual(['Ив', 'Пет']);
    expect(line().textContent).toBe('Иван Петров');
  });

  it('reads as one string: the marks add no text of their own', () => {
    expect(line().textContent).toBe('Иван Петров');
  });

  it('prints nothing for no runs', () => {
    fixture.componentInstance.runs.set([]);
    fixture.detectChanges();
    expect(line().textContent).toBe('');
    expect(line().querySelector('mark')).toBeNull();
  });

  it('marks nothing when no run is a hit', () => {
    fixture.componentInstance.runs.set([{ text: 'Фейд', hit: false }]);
    fixture.detectChanges();
    expect(line().querySelector('mark')).toBeNull();
    expect(line().textContent).toBe('Фейд');
  });

  it('follows its runs when they change', () => {
    fixture.componentInstance.runs.set([
      { text: 'Фе', hit: true },
      { text: 'йд', hit: false },
    ]);
    fixture.detectChanges();
    expect(line().querySelector('mark')?.textContent).toBe('Фе');
    expect(line().textContent).toBe('Фейд');
  });
});
