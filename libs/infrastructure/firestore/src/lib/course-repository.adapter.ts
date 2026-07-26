import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DocumentData,
  Query,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { Course, CourseId } from '@creativo/domain/programs';
import { CourseRepository } from '@creativo/application/programs';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { courseDocRef, coursesCollection } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

function toPersistence(course: Course): DocumentData {
  return {
    title: { en: course.title.en, bg: course.title.bg },
    description: { en: course.description.en, bg: course.description.bg },
    enrollmentStatus: course.enrollmentStatus,
    startsLabel: course.startsLabel
      ? { en: course.startsLabel.en, bg: course.startsLabel.bg }
      : null,
    applyUrl: course.applyUrl,
    sortOrder: course.sortOrder,
  };
}

function toDomain(
  id: string,
  data: DocumentData,
): Result<Course, RepositoryError> {
  const title = data['title'] as DocumentData;
  const description = data['description'] as DocumentData;
  const startsLabel = data['startsLabel'] as DocumentData | null;
  const reconstituted = Course.reconstitute({
    id,
    title: { en: title['en'], bg: title['bg'] },
    description: { en: description['en'], bg: description['bg'] },
    enrollmentStatus: data['enrollmentStatus'],
    ...(startsLabel && {
      startsLabel: { en: startsLabel['en'], bg: startsLabel['bg'] },
    }),
    ...(data['applyUrl'] && { applyUrl: data['applyUrl'] }),
    sortOrder: data['sortOrder'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed course document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

@Injectable()
export class FirestoreCourseRepository implements CourseRepository {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async findById(
    id: CourseId,
  ): Promise<Result<Course | null, RepositoryError>> {
    try {
      const snapshot = await getDoc(courseDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return toDomain(snapshot.id, snapshot.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to fetch course', error));
    }
  }

  async save(course: Course): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(courseDocRef(this.db, course.id), toPersistence(course));
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save course', error));
    }
  }

  observeOpenAndUpcoming(): Observable<
    Result<readonly Course[], RepositoryError>
  > {
    return this.observeQuery(
      query(
        coursesCollection(this.db),
        where('enrollmentStatus', 'in', ['open', 'upcoming']),
        orderBy('sortOrder'),
      ),
    );
  }

  observeAll(): Observable<Result<readonly Course[], RepositoryError>> {
    return this.observeQuery(
      query(coursesCollection(this.db), orderBy('sortOrder')),
    );
  }

  private observeQuery(
    coursesQuery: Query<DocumentData>,
  ): Observable<Result<readonly Course[], RepositoryError>> {
    return subscribeWithRetry<readonly Course[]>((onNext, onError) =>
      onSnapshot(
        coursesQuery,
        (snapshot) => {
          const courses: Course[] = [];
          for (const docSnap of snapshot.docs) {
            const result = toDomain(docSnap.id, docSnap.data());
            if (result.isFailure()) {
              onError(result.error);
              return;
            }
            courses.push(result.value);
          }
          onNext(courses);
        },
        onError,
      ),
    );
  }
}
