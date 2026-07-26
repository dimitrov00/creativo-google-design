import { TestBed } from '@angular/core/testing';
import { ModalSheetComponent } from './modal-sheet.component';

describe('ModalSheetComponent', () => {
  it('provides one accessible shell contract for projected sheet content', async () => {
    await TestBed.configureTestingModule({
      imports: [ModalSheetComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(ModalSheetComponent);
    fixture.componentRef.setInput('sheetId', 'test-sheet');
    fixture.componentRef.setInput('labelledBy', 'test-title');
    fixture.componentRef.setInput('closeLabel', 'Close details');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('#test-sheet[role="dialog"]')).not.toBeNull();
    expect(host.querySelector('[aria-labelledby="test-title"]')).not.toBeNull();
    expect(host.querySelector('.ui-sheet__surface')).not.toBeNull();
    expect(host.querySelector('.modal-sheet__scroll')).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="Close details"]'),
    ).not.toBeNull();
  });
});
