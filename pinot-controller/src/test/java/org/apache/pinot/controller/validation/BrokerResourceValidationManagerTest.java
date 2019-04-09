/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
package org.apache.pinot.controller.validation;

import java.io.File;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.commons.io.FileUtils;
import org.apache.helix.HelixAdmin;
import org.apache.helix.model.IdealState;
import org.apache.helix.model.InstanceConfig;
import org.apache.pinot.common.config.TableConfig;
import org.apache.pinot.common.config.TagNameUtils;
import org.apache.pinot.common.utils.CommonConstants;
import org.apache.pinot.common.utils.ZkStarter;
import org.apache.pinot.common.utils.helix.HelixHelper;
import org.apache.pinot.controller.ControllerConf;
import org.apache.pinot.controller.helix.ControllerRequestBuilderUtil;
import org.apache.pinot.controller.helix.ControllerTest;
import org.apache.pinot.util.TestUtils;
import org.testng.Assert;
import org.testng.annotations.AfterClass;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;


public class BrokerResourceValidationManagerTest extends ControllerTest {

  private static final int DEFAULT_CONTROLLER_PORT = 8998;
  private static final String DEFAULT_DATA_DIR =
      new File(FileUtils.getTempDirectoryPath(), "test-controller-" + System.currentTimeMillis()).getAbsolutePath();
  private static final String ZK_STR = ZkStarter.DEFAULT_ZK_STR;
  private static final String TEST_TABLE_NAME = "testTable";
  private static final String TEST_TABLE_TWO = "testTable2";
  private static final int BROKER_RESOURCE_VALIDATION_FREQUENCY_IN_SECOND = 3;
  private static final long MAX_TIMEOUT = BROKER_RESOURCE_VALIDATION_FREQUENCY_IN_SECOND * 1000L * 3;

  private TableConfig _offlineTableConfig;

  public static class MockControllerConf extends ControllerConf {

    public MockControllerConf() {
      super();
    }

    @Override
    public long getPeriodicTaskInitialDelayInSeconds() {
      return 0;
    }

    @Override
    public int getBrokerResourceValidationFrequencyInSeconds() {
      return BROKER_RESOURCE_VALIDATION_FREQUENCY_IN_SECOND;
    }
  }

  public static ControllerConf getDefaultControllerConfiguration() {
    ControllerConf config = new MockControllerConf();
    config.setControllerHost(LOCAL_HOST);
    config.setControllerPort(Integer.toString(DEFAULT_CONTROLLER_PORT));
    config.setDataDir(DEFAULT_DATA_DIR);
    config.setZkStr(ZkStarter.DEFAULT_ZK_STR);
    return config;
  }

  @BeforeClass
  public void setUp()
      throws Exception {
    startZk();
    ControllerConf config = getDefaultControllerConfiguration();
    startController(config);

    ControllerRequestBuilderUtil.addFakeDataInstancesToAutoJoinHelixCluster(getHelixClusterName(), ZK_STR, 2, true);
    ControllerRequestBuilderUtil.addFakeBrokerInstancesToAutoJoinHelixCluster(getHelixClusterName(), ZK_STR, 2, true);
    _offlineTableConfig =
        new TableConfig.Builder(CommonConstants.Helix.TableType.OFFLINE).setTableName(TEST_TABLE_NAME).setNumReplicas(2)
            .build();
    _helixManager = _helixResourceManager.getHelixZkManager();
    _helixResourceManager.addTable(_offlineTableConfig);
  }

  @Test
  public void testBrokerResourceValidationManager() throws Exception {
    // Check that the first table we added doesn't need to be rebuilt(case where ideal state brokers and brokers in broker resource are the same.
    String partitionName = _offlineTableConfig.getTableName();
    HelixAdmin helixAdmin = _helixManager.getClusterManagmentTool();

    // Ensure that the broker resource is not rebuilt.
    TestUtils.waitForCondition(input -> {
      IdealState idealState = HelixHelper.getBrokerIdealStates(helixAdmin, getHelixClusterName());
      return idealState.getInstanceSet(partitionName)
          .equals(_helixResourceManager.getAllInstancesForBrokerTenant(TagNameUtils.DEFAULT_TENANT_NAME));
    }, MAX_TIMEOUT, "Timeout when waiting for broker resource to be rebuilt");

    // Add another table that needs to be rebuilt
    TableConfig offlineTableConfigTwo =
        new TableConfig.Builder(CommonConstants.Helix.TableType.OFFLINE).setTableName(TEST_TABLE_TWO).build();
    _helixResourceManager.addTable(offlineTableConfigTwo);
    String partitionNameTwo = offlineTableConfigTwo.getTableName();

    // Add a new broker manually such that the ideal state is not updated and ensure that rebuild broker resource is called
    final String brokerId = "Broker_localhost_2";
    InstanceConfig instanceConfig = new InstanceConfig(brokerId);
    instanceConfig.setInstanceEnabled(true);
    instanceConfig.setHostName("Broker_localhost");
    instanceConfig.setPort("2");
    helixAdmin.addInstance(getHelixClusterName(), instanceConfig);
    helixAdmin.addInstanceTag(getHelixClusterName(), instanceConfig.getInstanceName(),
        TagNameUtils.getBrokerTagForTenant(TagNameUtils.DEFAULT_TENANT_NAME));

    // Count the number of times we check on ideal state change, which is made by rebuild broker resource method.
    AtomicInteger count = new AtomicInteger();
    TestUtils.waitForCondition(input -> {
      count.getAndIncrement();
      IdealState idealState = HelixHelper.getBrokerIdealStates(helixAdmin, getHelixClusterName());
      return idealState.getInstanceSet(partitionNameTwo)
          .equals(_helixResourceManager.getAllInstancesForBrokerTenant(TagNameUtils.DEFAULT_TENANT_NAME));
    }, MAX_TIMEOUT, "Timeout when waiting for broker resource to be rebuilt");

    // At least the broker resource won't be changed immediately.
    Assert.assertTrue(count.get() > 1);

    // Drop the instance so that broker resource doesn't match the current one.
    helixAdmin.dropInstance(getHelixClusterName(), instanceConfig);
    count.set(0);
    TestUtils.waitForCondition(input -> {
      count.getAndIncrement();
      IdealState idealState = HelixHelper.getBrokerIdealStates(helixAdmin, getHelixClusterName());
      return idealState.getInstanceSet(partitionNameTwo)
          .equals(_helixResourceManager.getAllInstancesForBrokerTenant(TagNameUtils.DEFAULT_TENANT_NAME));
    }, MAX_TIMEOUT, "Timeout when waiting for broker resource to be rebuilt");

    // At least the broker resource won't be changed immediately.
    Assert.assertTrue(count.get() > 1);
  }

  @AfterClass
  public void tearDown() {
    stopController();
    stopZk();
  }
}
