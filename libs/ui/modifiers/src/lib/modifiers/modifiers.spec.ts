import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Modifiers } from './modifiers';

describe('Modifiers', () => {
  let component: Modifiers;
  let fixture: ComponentFixture<Modifiers>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Modifiers],
    }).compileComponents();

    fixture = TestBed.createComponent(Modifiers);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
