import { useEffect, useState } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { AssessmentRecord, COLLECTIONS, EventRecord } from '@shared/types';
import { db, isFirebaseConfigured } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  isCurrentEventRecord,
  isCurrentResourceRecommendation,
  isCurrentAssessmentRecord,
  isCurrentRiskAssessment,
  M2PortfolioRecord,
} from './m2PortfolioData';

export function useM2Portfolio(previewRecords?: M2PortfolioRecord[]) {
  const { profile } = useAuth();
  const [records, setRecords] = useState<M2PortfolioRecord[]>(previewRecords ?? []);
  const [loading, setLoading] = useState(!previewRecords);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (previewRecords) {
      setRecords(previewRecords);
      setLoading(false);
      return;
    }
    if (!isFirebaseConfigured || !profile?.uid || !profile.authorityType) {
      setLoading(false);
      return;
    }

    let requestId = 0;
    let active = true;
    const eventsQuery = query(
      collection(db, COLLECTIONS.EVENTS),
      where('assignedOfficerUids', 'array-contains', profile.uid),
      limit(100),
    );

    const unsubscribe = onSnapshot(eventsQuery, async (snapshot) => {
      const currentRequest = ++requestId;
      try {
        const nextRecords = await Promise.all(snapshot.docs
          .map((eventDocument) => ({ expectedEventId: eventDocument.id, value: { eventId: eventDocument.id, ...eventDocument.data() } }))
          .filter(({ expectedEventId, value }) => isCurrentEventRecord(value, expectedEventId))
          .map(async ({ value }) => {
            const event = value as EventRecord;
            const eventReference = doc(db, COLLECTIONS.EVENTS, event.eventId);
            const assessmentId = event.currentAssessmentId ?? event.currentVersionId;
            const resourceId = event.currentResourceId;
            const [assessmentDocument, resourceDocument] = await Promise.all([
              assessmentId ? getDoc(doc(eventReference, COLLECTIONS.ASSESSMENTS, assessmentId)) : Promise.resolve(null),
              resourceId ? getDoc(doc(eventReference, COLLECTIONS.RESOURCES, resourceId)) : Promise.resolve(null),
            ]);
            const rawAssessment = assessmentDocument?.data() as AssessmentRecord | undefined;
            const rawResources = resourceDocument?.data();
            const validResources = isCurrentResourceRecommendation(rawResources)
              && rawResources.resourceId === resourceId
              && rawResources.eventId === event.eventId
              && rawResources.versionId === event.currentVersionId;
            return {
              event,
              assessment: isCurrentRiskAssessment(rawAssessment) ? rawAssessment : undefined,
              assessmentStatus: rawAssessment?.status,
              resources: validResources ? rawResources : undefined,
              legacyAssessment: Boolean(assessmentDocument?.exists() && !isCurrentAssessmentRecord(rawAssessment)),
              legacyResources: Boolean(rawResources) && !validResources,
            } satisfies M2PortfolioRecord;
          }));

        if (active && currentRequest === requestId) {
          setRecords(nextRecords);
          setError('');
          setLoading(false);
        }
      } catch {
        if (active && currentRequest === requestId) {
          setError('M2 assessment and resource data could not be loaded.');
          setLoading(false);
        }
      }
    }, () => {
      if (active) {
        setError('M2 assessment and resource data could not be loaded.');
        setLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [previewRecords, profile?.uid, profile?.authorityType, retryKey]);

  return {
    records,
    loading,
    error,
    retry: () => {
      setLoading(true);
      setRetryKey((value) => value + 1);
    },
  };
}
