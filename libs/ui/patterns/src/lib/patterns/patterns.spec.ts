import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Patterns } from './patterns';

describe('Patterns', () => {
  let component: Patterns;
  let fixture: ComponentFixture<Patterns>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Patterns],
    }).compileComponents();

    fixture = TestBed.createComponent(Patterns);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
