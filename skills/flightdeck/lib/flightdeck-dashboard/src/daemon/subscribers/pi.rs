use super::{Subscriber, SubscriberContext, SubscriberError, SubscriberHandle};

#[derive(Debug)]
pub struct PiSubscriber;

impl Subscriber for PiSubscriber {
    fn spawn(_ctx: SubscriberContext) -> Result<SubscriberHandle, SubscriberError> {
        Err(SubscriberError::Spawn(
            "pi subscriber implementation lands in the next Phase 5 commit".to_owned(),
        ))
    }
}
