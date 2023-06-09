/*
 * Copyright (c) 2006-2009 Erin Catto http://www.box2d.org
 *
 * This software is provided 'as-is', without any express or implied
 * warranty.  In no event will the authors be held liable for any damages
 * arising from the use of this software.
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 * 1. The origin of this software must not be misrepresented; you must not
 * claim that you wrote the original software. If you use this software
 * in a product, an acknowledgment in the product documentation would be
 * appreciated but is not required.
 * 2. Altered source versions must be plainly marked as such, and must not be
 * misrepresented as being the original software.
 * 3. This notice may not be removed or altered from any source distribution.
 */

// DEBUG: import { Assert } from "../Common/Settings";
import { BroadPhase } from '../Collision/BroadPhase'
import { TestOverlapAABB } from '../Collision/Collision'
import { TreeNode } from '../Collision/DynamicTree'

import { Body, BodyType } from './Body'
import { Contact, ContactEdge } from './Contacts/Contact'
import { ContactFactory } from './Contacts/ContactFactory'
import { Fixture, FixtureProxy } from './Fixture'
import { ContactFilter, ContactListener } from './WorldCallbacks'

// Delegate of World.
export class ContactManager {
  readonly m_broadPhase: BroadPhase<FixtureProxy> =
    new BroadPhase<FixtureProxy>()
  m_contactList: Contact | null = null
  m_contactCount = 0
  m_contactFilter: ContactFilter = ContactFilter.defaultFilter
  m_contactListener: ContactListener = ContactListener.defaultListener
  m_allocator: any = null

  m_contactFactory: ContactFactory

  constructor() {
    this.m_contactFactory = new ContactFactory(this.m_allocator)
  }

  // Broad-phase callback.
  AddPair(proxyA: FixtureProxy, proxyB: FixtureProxy): void {
    // DEBUG: Assert(proxyA instanceof FixtureProxy);
    // DEBUG: Assert(proxyB instanceof FixtureProxy);

    let fixtureA: Fixture = proxyA.fixture
    let fixtureB: Fixture = proxyB.fixture

    let indexA: number = proxyA.childIndex
    let indexB: number = proxyB.childIndex

    let bodyA: Body = fixtureA.GetBody()
    let bodyB: Body = fixtureB.GetBody()

    // Are the fixtures on the same body?
    if (bodyA === bodyB) {
      return
    }

    // TODO_ERIN use a hash table to remove a potential bottleneck when both
    // bodies have a lot of contacts.
    // Does a contact already exist?
    let edge: ContactEdge | null = bodyB.GetContactList()
    while (edge) {
      if (edge.other === bodyA) {
        const fA: Fixture = edge.contact.GetFixtureA()
        const fB: Fixture = edge.contact.GetFixtureB()
        const iA: number = edge.contact.GetChildIndexA()
        const iB: number = edge.contact.GetChildIndexB()

        if (
          fA === fixtureA &&
          fB === fixtureB &&
          iA === indexA &&
          iB === indexB
        ) {
          // A contact already exists.
          return
        }

        if (
          fA === fixtureB &&
          fB === fixtureA &&
          iA === indexB &&
          iB === indexA
        ) {
          // A contact already exists.
          return
        }
      }

      edge = edge.next
    }

    // Check user filtering.
    if (
      this.m_contactFilter &&
      !this.m_contactFilter.ShouldCollide(fixtureA, fixtureB)
    ) {
      return
    }

    // Call the factory.
    const c: Contact | null = this.m_contactFactory.Create(
      fixtureA,
      indexA,
      fixtureB,
      indexB
    )
    if (c === null) {
      return
    }

    // Contact creation may swap fixtures.
    fixtureA = c.GetFixtureA()
    fixtureB = c.GetFixtureB()
    indexA = c.GetChildIndexA()
    indexB = c.GetChildIndexB()
    bodyA = fixtureA.m_body
    bodyB = fixtureB.m_body

    // Insert into the world.
    c.m_prev = null
    c.m_next = this.m_contactList
    if (this.m_contactList !== null) {
      this.m_contactList.m_prev = c
    }
    this.m_contactList = c

    // Connect to island graph.

    // Connect to body A
    c.m_nodeA.contact = c
    c.m_nodeA.other = bodyB

    c.m_nodeA.prev = null
    c.m_nodeA.next = bodyA.m_contactList
    if (bodyA.m_contactList !== null) {
      bodyA.m_contactList.prev = c.m_nodeA
    }
    bodyA.m_contactList = c.m_nodeA

    // Connect to body B
    c.m_nodeB.contact = c
    c.m_nodeB.other = bodyA

    c.m_nodeB.prev = null
    c.m_nodeB.next = bodyB.m_contactList
    if (bodyB.m_contactList !== null) {
      bodyB.m_contactList.prev = c.m_nodeB
    }
    bodyB.m_contactList = c.m_nodeB

    // Wake up the bodies
    if (!fixtureA.IsSensor() && !fixtureB.IsSensor()) {
      bodyA.SetAwake(true)
      bodyB.SetAwake(true)
    }

    ++this.m_contactCount
  }

  FindNewContacts(): void {
    this.m_broadPhase.UpdatePairs(
      (proxyA: FixtureProxy, proxyB: FixtureProxy): void => {
        this.AddPair(proxyA, proxyB)
      }
    )
  }

  Destroy(c: Contact): void {
    const fixtureA: Fixture = c.GetFixtureA()
    const fixtureB: Fixture = c.GetFixtureB()
    const bodyA: Body = fixtureA.GetBody()
    const bodyB: Body = fixtureB.GetBody()

    if (this.m_contactListener && c.IsTouching()) {
      this.m_contactListener.EndContact(c)
    }

    // Remove from the world.
    if (c.m_prev) {
      c.m_prev.m_next = c.m_next
    }

    if (c.m_next) {
      c.m_next.m_prev = c.m_prev
    }

    if (c === this.m_contactList) {
      this.m_contactList = c.m_next
    }

    // Remove from body 1
    if (c.m_nodeA.prev) {
      c.m_nodeA.prev.next = c.m_nodeA.next
    }

    if (c.m_nodeA.next) {
      c.m_nodeA.next.prev = c.m_nodeA.prev
    }

    if (c.m_nodeA === bodyA.m_contactList) {
      bodyA.m_contactList = c.m_nodeA.next
    }

    // Remove from body 2
    if (c.m_nodeB.prev) {
      c.m_nodeB.prev.next = c.m_nodeB.next
    }

    if (c.m_nodeB.next) {
      c.m_nodeB.next.prev = c.m_nodeB.prev
    }

    if (c.m_nodeB === bodyB.m_contactList) {
      bodyB.m_contactList = c.m_nodeB.next
    }

    // Call the factory.
    this.m_contactFactory.Destroy(c)
    --this.m_contactCount
  }

  // This is the top level collision call for the time step. Here
  // all the narrow phase collision is processed for the world
  // contact list.
  Collide(): void {
    // Update awake contacts.
    let c: Contact | null = this.m_contactList
    while (c) {
      const fixtureA: Fixture = c.GetFixtureA()
      const fixtureB: Fixture = c.GetFixtureB()
      const indexA: number = c.GetChildIndexA()
      const indexB: number = c.GetChildIndexB()
      const bodyA: Body = fixtureA.GetBody()
      const bodyB: Body = fixtureB.GetBody()

      // Is this contact flagged for filtering?
      if (c.m_filterFlag) {
        // Check user filtering.
        if (
          this.m_contactFilter &&
          !this.m_contactFilter.ShouldCollide(fixtureA, fixtureB)
        ) {
          const cNuke: Contact = c
          c = cNuke.m_next
          this.Destroy(cNuke)
          continue
        }

        // Clear the filtering flag.
        c.m_filterFlag = false
      }

      const activeA: boolean =
        bodyA.IsAwake() && bodyA.m_type !== BodyType.staticBody
      const activeB: boolean =
        bodyB.IsAwake() && bodyB.m_type !== BodyType.staticBody

      // At least one body must be awake and it must be dynamic or kinematic.
      if (!activeA && !activeB) {
        c = c.m_next
        continue
      }

      const proxyA: TreeNode<FixtureProxy> = fixtureA.m_proxies[indexA].treeNode
      const proxyB: TreeNode<FixtureProxy> = fixtureB.m_proxies[indexB].treeNode
      const overlap: boolean = TestOverlapAABB(proxyA.aabb, proxyB.aabb)

      // Here we destroy contacts that cease to overlap in the broad-phase.
      if (!overlap) {
        const cNuke: Contact = c
        c = cNuke.m_next
        this.Destroy(cNuke)
        continue
      }

      // The contact persists.
      c.Update(this.m_contactListener)
      c = c.m_next
    }
  }
}
