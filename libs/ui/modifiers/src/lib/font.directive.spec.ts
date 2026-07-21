import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiFontDirective } from './font.directive';

@Component({
  imports: [UiFontDirective],
  template: `<p [uiFont]="font()">text</p>`,
})
class HostComponent {
  readonly font = signal<'title' | 'body'>('title');
}

describe('UiFontDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes data-font from the uiFont input', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('p');
    expect(el.getAttribute('data-font')).toBe('title');
  });

  it('updates data-font when the input changes', async () => {
    fixture.detectChanges();
    fixture.componentInstance.font.set('body');
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('p');
    expect(el.getAttribute('data-font')).toBe('body');
  });
});
